import { useState } from 'react';

function TodoList() {
    const [todos, setTodos] = useState([
        { id: 1, text: 'Buy milk', done: false },
        { id: 2, text: 'Walk dog', done: false }
    ]);

    function toggleTodo(id) {
        const todo = todos.find(t => t.id === id);
        todo.done = !todo.done;
        setTodos(todos);
    }

    return (
        <ul>
            {todos.map(t => (
                <li key={t.id} onClick={() => toggleTodo(t.id)}
                    style={{ textDecoration: t.done ? 'line-through' : 'none' }}>
                    {t.text}
                </li>
            ))}
        </ul>
    );
}

export default TodoList;
