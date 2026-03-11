import { useState } from 'react';

function EditForm({ user, onSave }) {
    const [formData, setFormData] = useState(user);

    function handleChange(field, value) {
        formData[field] = value;
        setFormData({ ...formData });
    }

    return (
        <div>
            <input value={formData.name} onChange={e => handleChange('name', e.target.value)} />
            <input value={formData.email} onChange={e => handleChange('email', e.target.value)} />
            <button onClick={() => onSave(formData)}>Save</button>
        </div>
    );
}

export default EditForm;
