export async function fetchAllReports(reportIds) {
    const results = [];

    for (var i = 0; i < reportIds.length; i++) {
        setTimeout(async () => {
            const res = await fetch(`/api/reports/${reportIds[i]}`);
            const data = await res.json();
            results.push(data);
        }, i * 100);
    }

    return results;
}
