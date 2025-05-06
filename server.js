// server.js
const express = require('express');
const { scrapeReddit } = require('./scraper');
const { closeDb, getPosts } = require('./database');

const app = express();
const port = 3000;
let isScraping = false;

// Helper function for basic HTML escaping (important!)
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe; // Handle non-strings gracefully
    return unsafe
         .replace(/&/g, "&")
         .replace(/</g, "<")
         .replace(/>/g, ">")
         .replace(/'/g, "'");
}

// Root Route
app.get('/', (req, res) => {
    res.send(`
        <h1>Reddit Scraper Control</h1>
        <p>Status: ${isScraping ? 'Scraping in progress...' : 'Idle'}</p>
        <ul>
            <li><a href="/start-scrape">Start Scraping /r/all</a></li>
            <li><a href="/posts">View Stored Posts</a></li>
        </ul>
        <p>Scraping runs in the console. Check console logs.</p>
        <p>Database file: reddit_posts.db</p>
    `);
});


// Scrape Route
app.get('/start-scrape', async (req, res) => {
    if (isScraping) {
        return res.status(400).send("Scraping is already in progress.");
    }

    isScraping = true;
    console.log("Received request to start scraping...");
    res.send("Scraping process initiated. Check the server console for progress. This will run until Ctrl+C is pressed or max scrolls reached.");

    try {
        await scrapeReddit();
    } catch (error) {
        console.error("Error during scrape execution:", error);
    } finally {
        isScraping = false;
        console.log("Scraping process has concluded or was interrupted.");
    }
});


// Route to display posts
app.get('/posts', async (req, res) => {
    console.log("[SERVER] Request received for /posts");
    try {
        const posts = await getPosts(200); // Get latest 200 posts
        console.log(`[SERVER] Fetched ${posts.length} posts from DB.`);

        let htmlResponse = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Stored Reddit Posts</title>
                <style>
                    body { font-family: sans-serif; margin: 20px; }
                    h1, p { text-align: center; }
                    table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 0.9em; }
                    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; vertical-align: top;}
                    th { background-color: #f2f2f2; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    td a { color: #0066cc; text-decoration: none; }
                    td a:hover { text-decoration: underline; }
                    .title-col { max-width: 350px; word-wrap: break-word; }
                    .id-col { width: 50px; }
                    .votes-col, .comments-col { width: 80px; text-align: right; }
                    .url-col { width: 60px; text-align: center; }
                    .date-col { width: 150px; }
                </style>
            </head>
            <body>
                <h1>Stored Reddit Posts</h1>
                <p><a href="/">Back to Control Panel</a> | Displaying latest ${posts.length} scraped posts</p>
                <table>
                    <thead>
                        <tr>
                            <th class="id-col">DB ID</th>
                            <th>Reddit ID</th>
                            <th class="title-col">Title</th>
                            <th class="votes-col">Upvotes</th>
                            <th class="comments-col">Comments</th>
                            <th class="url-col">URL</th>
                            <th class="date-col">Scraped At</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (posts.length === 0) {
            htmlResponse += '<tr><td colspan="7" style="text-align: center;">No posts found in the database yet. Try running the scraper first.</td></tr>';
        } else {
            posts.forEach(post => {
                const title = escapeHtml(post.title || 'N/A');
                const redditId = escapeHtml(post.reddit_id || 'N/A');
                const upvotes = escapeHtml(post.upvotes || 'N/A');
                const comments = escapeHtml(post.comments || 'N/A');
                const url = escapeHtml(post.url);
                const scrapedDate = post.scraped_at ? new Date(post.scraped_at).toLocaleString() : 'N/A';

                htmlResponse += `
                    <tr>
                        <td class="id-col">${post.id}</td>
                        <td>${redditId}</td>
                        <td class="title-col">${title}</td>
                        <td class="votes-col">${upvotes}</td>
                        <td class="comments-col">${comments}</td>
                        <td class="url-col">${url ? `<a href="${url}" target="_blank" rel="noopener noreferrer">Link</a>` : 'N/A'}</td>
                        <td class="date-col">${scrapedDate}</td>
                    </tr>
                `;
            });
        }

        htmlResponse += `
                    </tbody>
                </table>
            </body>
            </html>
        `;

        res.send(htmlResponse);

    } catch (error) {
        console.error("[SERVER] Error fetching posts for /posts route:", error);
        res.status(500).send("Error retrieving posts from database. Check server logs.");
    }
});


// Server Start and Shutdown
const server = app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});

process.on('SIGINT', () => {
    console.log('\nCaught interrupt signal (Ctrl+C). Shutting down...');
    isScraping = false;
    closeDb();
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
     setTimeout(() => {
         console.error("Could not close connections in time, forcing shut down");
         process.exit(1);
     }, 5000);
});