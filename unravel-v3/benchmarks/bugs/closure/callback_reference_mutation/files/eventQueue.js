const queue = [];

function enqueue(config) {
    const task = {
        run: () => {
            console.log('Processing:', config.action);
            fetch('/api/task', { method: 'POST', body: JSON.stringify(config) });
        }
    };
    queue.push(task);
}

function processQueue() {
    queue.forEach(task => task.run());
}

const jobConfig = { action: 'send_email', to: 'a@example.com' };
enqueue(jobConfig);

jobConfig.action = 'delete_user';
jobConfig.to = 'b@example.com';
enqueue(jobConfig);

processQueue();
