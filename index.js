const { chromium } = require('playwright');

const url = "https://www.reddit.com/r/all/?rdt=43638";
const scrollPixels = 300;
const scrollDelayMs = 2000;

(async () => {
    let browser = null;
    console.log("Launching browser...");

    try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"
        });
        const page = await context.newPage();

        page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));

        console.log(`[SCRIPT] Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log("[SCRIPT] Page navigation complete (domcontentloaded).");

        console.log("[SCRIPT] Performing initial wait for dynamic content (3 seconds)...");
        await page.waitForTimeout(3000);

        console.log("[SCRIPT] Waiting for post container selector...");
        await page.waitForSelector("shreddit-post, div[data-testid='post-container']", {
            state: 'visible',
            timeout: 30000
        });
        console.log("[SCRIPT] Initial content found. Starting infinite scroll...");
        console.log("[SCRIPT] Press Ctrl+C in the terminal to stop scrolling.");

        let scrollCount = 0;
        while (true) {
            console.log(`[SCRIPT] Loop iteration ${scrollCount + 1}. Evaluating smooth scroll...`);

            await page.evaluate((pixelsToScroll) => {
                document.documentElement.style.scrollBehavior = 'smooth';
                console.log(`[BROWSER] Attempting smooth scroll by ${pixelsToScroll}px. Current scrollY: ${window.scrollY}`);
                window.scrollBy(0, pixelsToScroll);
            }, scrollPixels);

            scrollCount++;
            console.log(`[SCRIPT] Scroll #${scrollCount}: Initiated smooth scroll command.`);

            console.log(`[SCRIPT] Waiting for ${scrollDelayMs / 1000}s...`);
            await page.waitForTimeout(scrollDelayMs);
        }

    } catch (error) {
        if (error.message.includes('Target page, context or browser closed')) {
            console.log('\n[SCRIPT] Scroll interrupted or browser closed.');
        } else if (error.name === 'TimeoutError') {
            console.error(`\n[SCRIPT] Error: Timed out waiting - ${error.message}`);
            console.error("[SCRIPT] Check the URL, network connection, or the selector used.");
        } else {
            console.error("\n[SCRIPT] An unexpected error occurred:", error);
        }
    } finally {
        if (browser) {
            console.log("[SCRIPT] Closing browser...");
            await browser.close();
        }
        console.log("[SCRIPT] Script finished.");
    }
})();