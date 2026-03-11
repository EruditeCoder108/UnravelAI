const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    database: 'myapp',
    max: 10
});

async function getUserById(id) {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM users WHERE id = $1', [id]);

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
}

async function updateUser(id, data) {
    const client = await pool.connect();

    try {
        await client.query('UPDATE users SET name=$1, email=$2 WHERE id=$3', [data.name, data.email, id]);
        return true;
    } catch (err) {
        return false;
    }
}
