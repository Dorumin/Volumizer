const fs = require('fs/promises');
const path = require('path');
const yargs = require('yargs');

const options = yargs
    .option('path', {
        description: 'The path towards the parent folder',
        type: 'string'
    })
    .option('max', {
        description: 'The max files to accept as direct children of the main folder',
        type: 'number'
    })
    .option('name', {
        description: 'The folder name, $n being replaced with the volume name',
        type: 'string',
        default: 'Vol $n'
    })
    .wrap(yargs.terminalWidth())
    .argv;


let globalState = {
    folderSet: new Set()
};

function splitFolders(entries) {
    const folders = [];
    const notFolders = [];

    for (const entry of entries) {
        if (entry.isDirectory()) {
            folders.push(entry);
        } else {
            notFolders.push(entry);
        }
    }

    return [folders, notFolders];
}

function folderName(number) {
    return options.name.replace('$n', number);
}

function findNewFolderName() {
    let n = 1;
    let nextName;

    // this control flow is shiiit... how could I do this better?
    while (true) {
        nextName = folderName(n);

        if (globalState.folderSet.has(nextName)) {
            n = n + 1;
            continue;
        }

        break;
    }

    return nextName;
}

function statFiles(files) {
    return Promise.all(
        files.map(async file => {
            const stat = await fs.stat(path.join(options.path, file.name));

            return {
                file,
                stat
            };
        })
    )
}

// your classic array chunking utility function
function chunkArray(array, max) {
    const chunked = [];
    let moved = 0;

    while (moved < array.length) {
        chunked.push(array.slice(moved, moved + max));

        moved += max;
    }

    return chunked;
}

async function moveChunk(chunk) {
    const folderName = findNewFolderName();

    // Mark as used
    globalState.folderSet.add(folderName);

    const folderPath = path.join(options.path, folderName);

    await fs.mkdir(folderPath);

    await Promise.all(
        chunk.map(entry => {
            const filePath = path.join(options.path, entry.file.name);
            const toPath = path.join(folderPath, entry.file.name);

            return fs.rename(filePath, toPath);
        })
    );
}

(async () => {
    const entries = await fs.readdir(options.path, {
        withFileTypes: true
    });

    const [folders, files] = splitFolders(entries);

    for (const folder of folders) {
        globalState.folderSet.add(folder.name);
    }

    if (files.length > options.max) {
        const filesWithStat = await statFiles(files);

        // Sort by last modified, oldest first
        filesWithStat.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

        const chunked = chunkArray(filesWithStat, options.max);

        // Remove the last chunk, as it'll be 250 files or less
        // Maybe you'd want the children to be moved if there's 250 of them, but nah
        chunked.pop();

        for (const chunk of chunked) {
            await moveChunk(chunk);
        }
    }
})();
