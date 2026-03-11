function createProcessor(largeDataset) {
    const processedCount = { value: 0 };

    function processNext() {
        if (processedCount.value < largeDataset.length) {
            const item = largeDataset[processedCount.value];
            processedCount.value++;
            return item;
        }
        return null;
    }

    return {
        next: processNext,
        getCount: () => processedCount.value
    };
}

const processors = [];

function addProcessor(data) {
    processors.push(createProcessor(data));
}

function clearProcessors() {
    processors.length = 0;
}
