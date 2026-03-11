async function processItems(items) {
    const results = [];

    items.forEach(async (item) => {
        const result = await processItem(item);
        results.push(result);
    });

    return results;
}

async function processItem(item) {
    return { id: item.id, processed: true };
}
