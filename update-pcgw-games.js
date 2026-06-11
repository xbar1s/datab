const https = require('https');
const fs = require('fs');
const path = require('path');

const DEV_GAMES_PATH = path.join(__dirname, 'developer-games.json');

function getJson(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };
        https.get(url, options, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch: Status code ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch(e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function cleanGameName(name) {
    if (!name) return '';
    name = name.trim();
    
    // Handle [[Link|Display Name]]
    const pipeMatch = name.match(/\[\[([^\]|]+)\|([^\]]+)\]\]/);
    if (pipeMatch) {
        return pipeMatch[2].trim();
    }
    
    // Handle [[Display Name]]
    const linkMatch = name.match(/\[\[([^\]]+)\]\]/);
    if (linkMatch) {
        return linkMatch[1].trim();
    }
    
    // Handle [URL Display Name]
    const urlMatch = name.match(/\[https?:\/\/[^\s]+\s+([^\]]+)\]/);
    if (urlMatch) {
        return urlMatch[1].trim();
    }
    
    return name.replace(/[\[\]]/g, '').trim();
}

function hasUpscaler(value) {
    if (!value) return false;
    const val = value.trim();
    if (val === '' || val === '➖' || val === '—' || val === '-') return false;
    return true;
}

function normalizeGameKey(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')   // strip special chars (colons, apostrophes, etc.)
        .trim()
        .replace(/\s+/g, '-');          // spaces → hyphens
}

async function main() {
    try {
        console.log("Fetching upscaling list from PCGamingWiki...");
        const url = 'https://www.pcgamingwiki.com/w/api.php?action=query&prop=revisions&titles=List_of_games_that_support_high-fidelity_upscaling&rvslots=*&rvprop=content&format=json';
        const res = await getJson(url);
        
        const pages = res.query.pages;
        const pageId = Object.keys(pages)[0];
        if (pageId === '-1') {
            throw new Error("Page not found on PCGamingWiki");
        }
        
        const content = pages[pageId].revisions[0].slots.main['*'];
        const lines = content.split('\n');
        
        // Parse games from source content
        const parsedGames = {};
        const rowRegex = /\{\{Upscaling list\/row\|([^}]+)\}\}/;

        for (const line of lines) {
            const match = line.match(rowRegex);
            if (match) {
                const parts = match[1].split('|');
                if (parts.length >= 5) {
                    const rawName = parts[0];
                    const fsrVal = parts[2];
                    const dlssVal = parts[3];
                    const xessVal = parts[4];
                    
                    const name = cleanGameName(rawName);
                    const dlss = hasUpscaler(dlssVal);
                    const fsr = hasUpscaler(fsrVal);
                    const xess = hasUpscaler(xessVal);

                    if (name && (dlss || fsr || xess)) {
                        const key = normalizeGameKey(name);
                        const compatibility = dlss ? 'green' : 'yellow';
                        parsedGames[key] = {
                            compatibility
                        };
                    }
                }
            }
        }
        
        console.log(`Parsed ${Object.keys(parsedGames).length} games from PCGamingWiki.`);

        // Read existing developer-games.json if it exists
        let devGames = {};
        if (fs.existsSync(DEV_GAMES_PATH)) {
            try {
                devGames = JSON.parse(fs.readFileSync(DEV_GAMES_PATH, 'utf-8'));
                console.log(`Loaded ${Object.keys(devGames).length} existing entries from developer-games.json.`);
            } catch (e) {
                console.warn("Could not read or parse existing developer-games.json, starting fresh:", e.message);
            }
        }

        // Merge logic
        const mergedGames = { ...devGames };

        for (const [key, parsedGame] of Object.entries(parsedGames)) {
            if (mergedGames[key]) {
                // If it already exists, preserve its compatibility and path tweaks (if they exist)
                // If the existing entry doesn't have compatibility, use the parsed one
                if (!mergedGames[key].compatibility) {
                    mergedGames[key].compatibility = parsedGame.compatibility;
                }
            } else {
                // New game found from PCGamingWiki
                mergedGames[key] = {
                    compatibility: parsedGame.compatibility
                };
            }
        }

        // Sort keys alphabetically to keep developer-games.json clean and diff-friendly
        const sortedGames = {};
        Object.keys(mergedGames).sort().forEach(key => {
            sortedGames[key] = mergedGames[key];
        });

        // Write output back to file
        fs.writeFileSync(DEV_GAMES_PATH, JSON.stringify(sortedGames, null, 2), 'utf-8');
        console.log(`Successfully updated developer-games.json! Total games: ${Object.keys(sortedGames).length}`);

    } catch (e) {
        console.error("Error updating developer games:", e);
        process.exit(1);
    }
}

main();
