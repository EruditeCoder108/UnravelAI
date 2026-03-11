const fs = require('fs');

async function processLogFile(filePath) {
    const fileHandle = await fs.promises.open(filePath, 'r');
    const content = await fileHandle.readFile({ encoding: 'utf8' });
    const lines = content.split('\n');

    if (lines.length === 0) {
        return [];
    }

    const results = lines
        .filter(line => line.includes('ERROR'))
        .map(line => ({ timestamp: line.split(' ')[0], message: line }));

    return results;
}

async function processMultipleLogs(files) {
    const allResults = [];
    for (const file of files) {
        const results = await processLogFile(file);
        allResults.push(...results);
    }
    return allResults;
}
