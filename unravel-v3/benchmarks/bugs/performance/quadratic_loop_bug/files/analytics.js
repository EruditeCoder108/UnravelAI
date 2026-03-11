function findDuplicateEvents(events) {
    const duplicates = [];

    for (let i = 0; i < events.length; i++) {
        for (let j = 0; j < events.length; j++) {
            if (i !== j && events[i].id === events[j].id) {
                if (!duplicates.find(d => d.id === events[i].id)) {
                    duplicates.push(events[i]);
                }
            }
        }
    }

    return duplicates;
}

function processEventBatch(events) {
    const duplicates = findDuplicateEvents(events);
    const unique = events.filter(e => !duplicates.find(d => d.id === e.id));
    return { unique, duplicates };
}
