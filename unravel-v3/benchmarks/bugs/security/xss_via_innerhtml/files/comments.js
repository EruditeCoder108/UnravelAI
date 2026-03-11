async function loadComments(postId) {
    const response = await fetch(`/api/posts/${postId}/comments`);
    const comments = await response.json();

    const container = document.getElementById('comments');
    container.innerHTML = '';

    comments.forEach(comment => {
        const div = document.createElement('div');
        div.innerHTML = `
            <strong>${comment.author}</strong>
            <p>${comment.text}</p>
            <span>${comment.timestamp}</span>
        `;
        container.appendChild(div);
    });
}
