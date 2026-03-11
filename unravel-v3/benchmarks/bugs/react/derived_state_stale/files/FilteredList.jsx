import { useState } from 'react';

function FilteredList({ items }) {
    const [filter, setFilter] = useState('');
    const [filtered, setFiltered] = useState(items);

    function handleFilter(e) {
        const value = e.target.value;
        setFilter(value);
        setFiltered(items.filter(item => item.name.includes(value)));
    }

    return (
        <div>
            <input value={filter} onChange={handleFilter} placeholder="Filter..." />
            <ul>
                {filtered.map(item => <li key={item.id}>{item.name}</li>)}
            </ul>
        </div>
    );
}

export default FilteredList;
