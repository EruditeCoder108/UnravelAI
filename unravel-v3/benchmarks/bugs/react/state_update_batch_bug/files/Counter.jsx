import { useState } from 'react';

function Counter() {
    const [count, setCount] = useState(0);

    function incrementThrice() {
        setCount(count + 1);
        setCount(count + 1);
        setCount(count + 1);
    }

    return (
        <div>
            <p>{count}</p>
            <button onClick={incrementThrice}>+3</button>
        </div>
    );
}

export default Counter;
