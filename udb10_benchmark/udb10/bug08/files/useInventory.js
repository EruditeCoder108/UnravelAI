import { useState, useEffect } from 'react';

export function useInventory(warehouseId) {
    const [inventory, setInventory] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        async function loadInventory() {
            try {
                const res = await fetch(`/api/warehouse/${warehouseId}/inventory`);
                const data = await res.json();
                setInventory(data.items);
            } catch (err) {
                setError(err.message);
            }
        }

        // BUG: loadInventory() is not awaited — useEffect cannot be async directly,
        // but the floating promise means if the component unmounts before the fetch
        // completes, setInventory and setError will still fire on unmounted component.
        // Also: no cleanup, no AbortController — navigation away mid-fetch causes
        // the state update to hit an unmounted component.
        loadInventory();

        // No return cleanup function — cannot cancel the in-flight request
    }, [warehouseId]);

    return { inventory, error };
}
