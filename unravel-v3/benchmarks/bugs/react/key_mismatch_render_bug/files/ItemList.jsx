import { useState } from 'react';

function ItemList() {
    const [items, setItems] = useState([
        { id: 1, name: 'Apple' },
        { id: 2, name: 'Banana' },
        { id: 3, name: 'Cherry' }
    ]);

    function removeFirst() {
        setItems(items.slice(1));
    }

    return (
        <div>
            <button onClick={removeFirst}>Remove First</button>
            <ul>
                {items.map((item, index) => (
                    <li key={index}>
                        <input defaultValue={item.name} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default ItemList;
