const sqlite3 = require('sqlite3').verbose();
const DB_FILE = './reddit_posts.db';

const db = new sqlite3.Database(DB_FILE, (err) => {
   
    if (!err) {
        createTable();
    }
});

function createTable() {

}

function savePost(postData) {

}

function getPosts(limit = 100) { 
    return new Promise((resolve, reject) => {
     
        const sql = `
            SELECT id, reddit_id, title, upvotes, comments, url, scraped_at
            FROM posts
            ORDER BY scraped_at DESC
            LIMIT ?;
        `;
        db.all(sql, [limit], (err, rows) => {
            if (err) {
                console.error("Error fetching posts:", err.message);
                reject(err); 
            } else {
                resolve(rows); 
            }
        });
    });
}

function closeDb() {
}

module.exports = {
    savePost,
    closeDb,
    getPosts
};