import { useState, useCallback, useRef } from 'react';

export function useFormSubmit(onSuccess) {
    const [count, setCount] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const submitCountRef = useRef(0);

    // Looks correct — onSuccess is in the dependency array.
    // But count is NOT in the dep array, and handleSubmit closes over count.
    const handleSubmit = useCallback(async (formData) => {
        if (submitting) return;
        setSubmitting(true);

        try {
            await fetch('/api/submit', {
                method: 'POST',
                body: JSON.stringify({ ...formData, attemptNumber: count }),
            });

            submitCountRef.current += 1;
            setCount(c => c + 1);
            onSuccess(count); // count is stale — always passes the value from first render
        } finally {
            setSubmitting(false);
        }
    }, [onSuccess, submitting]);
    //   ^^^ count is missing — onSuccess(count) will always send 0

    return { handleSubmit, count, submitting };
}
