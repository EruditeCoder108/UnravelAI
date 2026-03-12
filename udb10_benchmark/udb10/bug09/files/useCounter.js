import { useReducer, useCallback } from 'react';

const initialState = { count: 0, step: 1, history: [] };

function reducer(state, action) {
    switch (action.type) {
        case 'INCREMENT':
            return {
                ...state,
                count: state.count + state.step,
                history: [...state.history, state.count + state.step],
            };
        case 'SET_STEP':
            return { ...state, step: action.payload };
        default:
            return state;
    }
}

export function useCounter() {
    const [state, dispatch] = useReducer(reducer, initialState);

    // Destructure primitives from state — this is fine for rendering
    const { count, step } = state;

    // BUG: increment closes over the destructured `step` primitive.
    // When step changes, increment is memoized with the OLD step value
    // because step (a primitive copy) is in deps but the closure
    // was already formed with the stale copy from the previous render's destructure.
    const increment = useCallback(() => {
        dispatch({ type: 'INCREMENT' });
    }, []);
    // The real bug: this looks fine but if increment were to USE step directly
    // (e.g. for validation), it would be stale. More critically:

    const incrementByDouble = useCallback(() => {
        // Uses the destructured `step` — stale after SET_STEP fires
        dispatch({ type: 'SET_STEP', payload: step * 2 });
        dispatch({ type: 'INCREMENT' });
    }, []);
    // step missing from deps — always doubles the INITIAL step (1), never the current one

    return { count, step, increment, incrementByDouble, dispatch };
}
