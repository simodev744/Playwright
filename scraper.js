// scraper.js
const { chromium } = require('playwright');
const { savePost } = require('./database'); // Import the save function

// --- Configuration ---
const redditUrl = "https://www.reddit.com/r/all/"; // Using a cleaner URL, redirects usually handle params like rdt
const scrollPixels = 500; // How many pixels to scroll each time (adjust as needed)
const scrollDurationMs = 750; // Duration for the smooth scroll animation
const scrollDelayMs = 3000; // Wait time AFTER scroll animation finishes for content load
const maxScrolls = 100; // Limit scrolls (e.g., 100) for testing, set to null or a very high number for longer runs
const postSelector = "shreddit-post, div[data-testid='post-container']"; // Selector for post elements
// --- End Configuration ---

// --- Helper function for smooth scrolling ---
async function smoothScrollBy(page, distance, duration) {
    console.log(`[SCRAPER] Smooth scrolling by ${distance}px over ${duration}ms`);
    await page.evaluate(async ({ dist, dur }) => { // Pass args as object
        await new Promise((resolve) => {
            const startY = window.scrollY;
            const targetY = startY + dist;
            const startTime = performance.now();

            function step() {
                const now = performance.now();
                const timeElapsed = now - startTime;
                const progress = Math.min(timeElapsed / dur, 1); // Ensure progress doesn't exceed 1
                const easeProgress = progress; // Simple linear easing
                const currentY = startY + dist * easeProgress;
                window.scrollTo(0, currentY);

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    window.scrollTo(0, targetY); // Ensure final position
                    // console.log('[BROWSER] Smooth scroll finished.'); // Browser-side log (optional)
                    resolve();
                }
            }
            requestAnimationFrame(step);
        });
    }, { dist: distance, dur: duration }); // Pass distance and duration into evaluate
}
// --- End of helper function ---


async function scrapeReddit() {
    let browser = null;
    const scrapedRedditIds = new Set(); // Keep track of processed IDs in THIS RUN
    console.log("[SCRAPER] Starting scrape process...");

    try {
        console.log("[SCRAPER] Launching browser...");
        // Consider headless: true for server environments
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36" // Updated UA
        });
        const page = await context.newPage();
         page.setDefaultTimeout(60000); // 60 seconds default timeout

        console.log(`[SCRAPER] Navigating to ${redditUrl}...`);
        // Using 'domcontentloaded' or 'load' might be faster/more reliable than 'networkidle' for infinite scroll
        await page.goto(redditUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
        console.log("[SCRAPER] Page loaded. Waiting for initial posts...");

        // Wait for the feed container or a post element to ensure content started loading
        await page.waitForSelector(postSelector, { state: 'visible', timeout: 30000 });
        console.log("[SCRAPER] Initial content detected. Starting scroll and scrape loop...");

        let scrollAttempts = 0;
        while (maxScrolls === null || scrollAttempts < maxScrolls) {
            scrollAttempts++;
            console.log(`\n[SCRAPER] Scroll attempt #${scrollAttempts}/${maxScrolls ?? 'Infinite'}`);

            // --- Extract Data ---
            const postElements = await page.$$(postSelector); // Find all potential post containers
            console.log(`[SCRAPER] Found ${postElements.length} potential post elements in current view.`);
            let postsFoundInBatch = 0;

            for (const postElement of postElements) {
                let postData = null;
                try {
                    postData = await postElement.evaluate(el => {
                        // --- Selectors (WARNING: Highly dependent on Reddit's current HTML structure!) ---
                        const titleElement = el.querySelector('[slot="title"], h1, h2, h3'); // Common places for titles
                        const scoreElement = el.querySelector('[data-testid="score"], faceplate-number[number]'); // More specific selector for score
                        const commentsElement = el.querySelector('[data-testid="comment-count"], a[data-testid="comments-button"]');
                        const linkElement = el.querySelector('a[data-testid="post-title"], a[slot="full-post-link"]');
                        const redditId = el.id || el.getAttribute('data-fullname') || el.getAttribute('data-mfe-id'); // Extract Reddit's unique ID

                        const title = titleElement?.textContent?.trim() || null;
                        const upvotes = scoreElement?.getAttribute('number') || scoreElement?.textContent?.trim() || '0'; // Prioritize 'number' attribute if available
                        const commentsText = commentsElement?.textContent?.trim() || '0 comments';
                        const url = linkElement?.href || null;

                        // Basic parsing (handle 'K' for thousands, remove ' comments')
                        let parsedUpvotes = 0;
                        if (upvotes) {
                            if (upvotes.toUpperCase().includes('K')) {
                                parsedUpvotes = parseFloat(upvotes) * 1000;
                            } else {
                                parsedUpvotes = parseInt(upvotes, 10) || 0;
                            }
                        }
                        const parsedComments = parseInt(commentsText.split(' ')[0], 10) || 0;


                        return {
                            reddit_id: redditId,
                            title: title,
                            upvotes: parsedUpvotes, // Store parsed number
                            comments: parsedComments, // Store parsed number
                            url: url
                        };
                    });

                    // --- Save to Database (if valid and NEW in this run) ---
                    if (postData?.reddit_id && postData?.title && !scrapedRedditIds.has(postData.reddit_id)) {
                        try {
                            await savePost(postData.reddit_id, postData.title, postData.url, postData.upvotes, postData.comments);
                            scrapedRedditIds.add(postData.reddit_id); // Add to set ONLY after successful save attempt
                            postsFoundInBatch++;
                            // console.log(`[SCRAPER] Saved post: ${postData.reddit_id} - ${postData.title.substring(0,30)}...`);
                        } catch (dbError) {
                             if (dbError.message && dbError.message.includes('UNIQUE constraint failed')) {
                                 // console.log(`[SCRAPER] Post ${postData.reddit_id} already exists in DB (handled).`);
                                 scrapedRedditIds.add(postData.reddit_id); // Still add to set to prevent retries in this run
                             } else {
                                console.error(`[SCRAPER] Error saving post ${postData.reddit_id} to DB:`, dbError);
                             }
                        }
                    } else if (postData?.reddit_id && scrapedRedditIds.has(postData.reddit_id)) {
                        // Already processed in this run, skip silently
                    } else if (postData) {
                        // console.log("[SCRAPER] Skipping element, missing ID or Title:", postData);
                    }

                } catch (extractError) {
                    console.error(`[SCRAPER] Error extracting data from one post element: ${extractError.message}. Skipping element.`);
                    // console.debug("Element outerHTML (start):", await postElement.evaluate(el => el.outerHTML.substring(0, 200))); // For debugging
                }
                 // Small delay no longer needed as processing is faster and scroll delay exists
                 // await page.waitForTimeout(50);
            } // End for loop through post elements
            console.log(`[SCRAPER] Processed ${postsFoundInBatch} new unique posts in this batch.`);


            // --- Scroll ---
            await smoothScrollBy(page, scrollPixels, scrollDurationMs);

            // --- Wait ---
            console.log(`[SCRAPER] Waiting ${scrollDelayMs / 1000}s for new content...`);
            await page.waitForTimeout(scrollDelayMs); // Wait for content to load after scroll

            // Optional: Check if scroll height changed - can indicate end of page (less reliable with dynamic loading)
            // const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
            // console.log("[SCRAPER] Current scroll height:", scrollHeight);

        } // End while loop (scrolling)

        console.log(`[SCRAPER] Reached max scrolls (${maxScrolls}) or finished loop.`);

    } catch (error) {
        console.error("[SCRAPER] A critical error occurred during scraping:", error);
    } finally {
        if (browser) {
            console.log("[SCRAPER] Closing browser...");
            await browser.close();
        }
        console.log(`[SCRAPER] Scrape process finished. Total unique posts processed in this run: ${scrapedRedditIds.size}`);
    }
}

module.exports = { scrapeReddit };