// Import necessary modules
const { chromium } = require('playwright');
const sqlite3 = require('sqlite3').verbose(); // Use verbose for more detailed errors
const express = require('express');
const path = require('path');
const url = require('url'); // To parse URLs for coordinates

// --- Configuration ---
const SEARCH_TERMS = [
    "Eiffel Tower Paris",
    "Statue of Liberty New York",
    "British Museum London",
    "Colosseum Rome",
    "Sydney Opera House",
    "Central Park New York", // Example with potentially less specific data
    "Invalid Place Name XYZ123", // Example for testing not found
];
const DATABASE_FILE = path.join(__dirname, 'places.db');
const PORT = 3000;
const PAGINATION_LIMIT = 5; // Number of results per page

// --- Database Setup ---
const db = new sqlite3.Database(DATABASE_FILE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        // Create table if it doesn't exist
        db.run(`CREATE TABLE IF NOT EXISTS places (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            search_term TEXT,
            name TEXT,
            address TEXT,
            latitude REAL,
            longitude REAL,
            country TEXT,
            category TEXT, -- 'place type' or category
            phone TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            } else {
                console.log('Table "places" is ready.');
            }
        });
    }
});

// Function to insert data into the database
function insertPlace(placeData) {
    const sql = `INSERT INTO places (search_term, name, address, latitude, longitude, country, category, phone)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [
        placeData.searchTerm,
        placeData.name,
        placeData.address,
        placeData.latitude,
        placeData.longitude,
        placeData.country,
        placeData.category,
        placeData.phone
    ], function(err) { // Use function() to access this.lastID
        if (err) {
            console.error(`Error inserting data for "${placeData.searchTerm}":`, err.message);
        } else {
            console.log(`Successfully inserted "${placeData.name || placeData.searchTerm}" with ID: ${this.lastID}`);
        }
    });
}

// --- Playwright Scraping Logic ---
async function scrapeGoogleMaps() {
    console.log('Starting Playwright scraping...');
    const browser = await chromium.launch({ headless: false }); // Use true for production, false for debugging
    const context = await browser.newContext({
         // Try setting a common user agent
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        // Set language preferences to potentially get more consistent results
        locale: 'en-US',
        timezoneId: 'America/New_York', // Example timezone
    });
    const page = await context.newPage();

    for (const term of SEARCH_TERMS) {
        console.log(`\n--- Searching for: ${term} ---`);
        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(term)}`;

        try {
            await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 60000 }); // Wait longer if needed

            // IMPORTANT: Wait for the main results panel to likely appear
            // Selector might need adjustment! This targets a common container role.
             const resultsPanelSelector = 'div[role="main"]'; // Adjust if needed!
             await page.waitForSelector(resultsPanelSelector, { timeout: 20000 }).catch(() => console.log(`Results panel selector (${resultsPanelSelector}) not found for "${term}". Skipping.`));


            // Attempt to find the primary result's details
            // Selectors are guesses based on common Google Maps structure - **VERY LIKELY TO BREAK**
            const mainResultSelector = 'div[role="main"]'; // Often the first main div holds key info
            const nameSelector = `${mainResultSelector} h1`; // Main title is usually H1
            const addressSelector = `${mainResultSelector} [data-item-id="address"], ${mainResultSelector} button[data-tooltip*="address"] > div > div:nth-child(1)`; // Try common address patterns
            const phoneSelector = `${mainResultSelector} [data-item-id*="phone"], ${mainResultSelector} button[data-tooltip*="phone"] > div > div:nth-child(1)`; // Try common phone patterns
            const categorySelector = `${mainResultSelector} button[jsaction*="category"]`; // Category often in a button

            let placeData = {
                searchTerm: term,
                name: null,
                address: null,
                latitude: null,
                longitude: null,
                country: null, // Harder to get reliably, might need parsing address
                category: null,
                phone: null,
            };

            // Extract Name
            try {
                placeData.name = await page.locator(nameSelector).first().innerText({ timeout: 5000 });
                console.log(`  Name: ${placeData.name}`);
            } catch (e) {
                console.log(`  Could not extract name for "${term}".`);
            }

             // Extract Address
             try {
                 // Try the first selector pattern
                 let addressElement = page.locator(addressSelector).first();
                 if (await addressElement.count() > 0) {
                     placeData.address = await addressElement.innerText({ timeout: 5000 });
                 } else {
                     // Fallback or alternative selector if needed
                     console.log(`  Primary address selector failed, checking alternatives...`);
                     // Add other potential selectors here if the first one fails often
                     placeData.address = "N/A"; // Default if none found
                 }

                 if (placeData.address && placeData.address !== "N/A") {
                    console.log(`  Address: ${placeData.address}`);
                    // Attempt to parse Country from address (basic example)
                    const addressParts = placeData.address.split(', ');
                    if (addressParts.length > 1) {
                        // Very naive guess: last part is often country or state/country
                        placeData.country = addressParts[addressParts.length - 1];
                        // Refine country extraction if needed (e.g., check against a list of known countries)
                        console.log(`  Guessed Country: ${placeData.country}`);
                    }
                } else {
                     console.log(`  Could not extract address for "${term}".`);
                     placeData.address = "N/A"; // Set explicitly if not found
                }


            } catch (e) {
                console.log(`  Error extracting address for "${term}": ${e.message}`);
                placeData.address = "N/A";
            }


            // Extract Phone
            try {
                placeData.phone = await page.locator(phoneSelector).first().innerText({ timeout: 5000 });
                console.log(`  Phone: ${placeData.phone}`);
            } catch (e) {
                // It's common for phone numbers not to be present or easily selectable
                console.log(`  Could not extract phone number for "${term}".`);
                placeData.phone = "N/A";
            }

            // Extract Category
            try {
                placeData.category = await page.locator(categorySelector).first().innerText({ timeout: 5000 });
                console.log(`  Category: ${placeData.category}`);
            } catch (e) {
                console.log(`  Could not extract category for "${term}".`);
                placeData.category = "N/A";
            }

            await page.waitForTimeout(1500); // Small delay to let URL potentially update
            const currentUrl = page.url();
            const match = currentUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (match && match.length >= 3) {
                placeData.latitude = parseFloat(match[1]);
                placeData.longitude = parseFloat(match[2]);
                console.log(`  Coords: Lat ${placeData.latitude}, Lng ${placeData.longitude}`);
            } else {
                console.log(`  Could not extract coordinates from URL for "${term}". URL: ${currentUrl}`);
            }

            // Insert data only if we found at least a name or address
             if (placeData.name || (placeData.address && placeData.address !== "N/A")) {
                insertPlace(placeData);
            } else {
                console.log(`  Skipping database insertion for "${term}" due to missing name and address.`);
            }


        } catch (error) {
            console.error(`Error processing "${term}": ${error.message}`);
             if (error.message.includes('Timeout')) {
                 console.warn(`  Timeout likely occurred. Google Maps structure might have changed or page took too long.`);
             }
        }

        // Add a delay to avoid overwhelming Google Maps
        const delay = Math.random() * 2000 + 1000; // Random delay between 1-3 seconds
        console.log(`  Waiting for ${Math.round(delay / 1000)}s...`);
        await page.waitForTimeout(delay);
    }

    await browser.close();
    console.log('\nPlaywright scraping finished.');
}

// --- Express Server Logic ---
const app = express();

// API Endpoint to get places with pagination
app.get('/places', (req, res) => {
    const page = parseInt(req.query.page) || 1; // Default to page 1
    const limit = PAGINATION_LIMIT;
    const offset = (page - 1) * limit;

    const dataSql = `SELECT id, name, address, latitude, longitude, country, category, phone, scraped_at
                     FROM places
                     ORDER BY scraped_at DESC
                     LIMIT ? OFFSET ?`;

    const countSql = `SELECT COUNT(*) as count FROM places`;

    db.get(countSql, [], (err, countRow) => {
        if (err) {
            console.error('Error counting places:', err.message);
            return res.status(500).json({ error: 'Failed to count places' });
        }

        const totalItems = countRow.count;
        const totalPages = Math.ceil(totalItems / limit);

        db.all(dataSql, [limit, offset], (err, rows) => {
            if (err) {
                console.error('Error fetching places:', err.message);
                return res.status(500).json({ error: 'Failed to fetch places' });
            }

            res.json({
                data: rows,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    itemsPerPage: limit
                }
            });
        });
    });
});

// Simple HTML page to show how to use the API
app.get('/', (req, res) => {
    res.send(`
        <h1>Google Maps Scraper Results</h1>
        <p>Data is scraped and stored in SQLite.</p>
        <p>Access the paginated data via the <a href="/places">/places</a> API endpoint.</p>
        <p>Use query parameter <code>?page=N</code> to navigate pages (e.g., <a href="/places?page=2">/places?page=2</a>).</p>
        <h2>Example API Usage (Fetch Page 1):</h2>
        <pre id="api-output">Loading...</pre>
        <script>
            fetch('/places?page=1')
                .then(response => response.json())
                .then(data => {
                    document.getElementById('api-output').textContent = JSON.stringify(data, null, 2);
                })
                .catch(error => {
                    document.getElementById('api-output').textContent = "Error fetching data: " + error;
                });
        </script>
    `);
});


// --- Main Execution ---
async function main() {
    // Run scraper first (optional, could be run separately)
    // You might want to comment this out after the first run
    // or add a command-line flag to control scraping vs. just serving.
    await scrapeGoogleMaps();

    // Start the Express server
    app.listen(PORT, () => {
        console.log(`\nServer listening on http://localhost:${PORT}`);
        console.log(`Access scraped data at: http://localhost:${PORT}/places`);
        console.log(`Use ?page= query parameter for pagination (e.g., http://localhost:${PORT}/places?page=2)`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nCaught interrupt signal, closing database connection...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err.message);
        } else {
            console.log('Database connection closed.');
        }
        process.exit(0);
    });
});

// Run the main function
main().catch(err => {
    console.error("Unhandled error during execution:", err);
    db.close(); // Attempt to close DB even on error
    process.exit(1);
});