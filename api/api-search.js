import fetch from 'node-fetch';

const SERPER_API_URL = "https://google.serper.dev/search";

// Helper function to extract important keywords
function extractKeywords(text, maxKeywords) {
    if (!text) return [];
    
    const fillerWords = ['the', 'a', 'an', 'that', 'this', 'these', 'those', 'is', 'are', 'was', 'were', 
                        'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'should', 
                        'would', 'could', 'will', 'shall', 'may', 'might', 'must', 'can', 'resolved', 
                        'debate', 'argument', 'therefore', 'thus', 'hence', 'because', 'since'];
    
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    
    const keywords = words
        .filter(word => !fillerWords.includes(word) && word.length > 3)
        .sort((a, b) => b.length - a.length)
        .slice(0, maxKeywords);
    
    return keywords;
}

// Helper function to search for evidence
async function searchForEvidence(query, numResults = 10) {
    try {
        const response = await fetch(SERPER_API_URL, {
            method: 'POST',
            headers: {
                'X-API-KEY': process.env.SERPER_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: query,
                num: numResults,
                gl: 'us',
                hl: 'en'
            })
        });

        if (!response.ok) {
            throw new Error(`Serper API error: ${response.status}`);
        }

        const data = await response.json();
        return data.organic || [];
    } catch (error) {
        console.error('Search error:', error);
        throw error;
    }
}

// Main handler function for Vercel
export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { query, searchType = 'general', numResults = 10 } = req.body;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
            return res.status(400).json({ error: 'Query is required and must be a non-empty string' });
        }

        // Validate API key
        if (!process.env.SERPER_API_KEY) {
            console.error('SERPER_API_KEY not found in environment variables');
            return res.status(500).json({ error: 'Search service not configured' });
        }

        let searchQuery = query.trim();
        let results = [];

        if (searchType === 'evidence') {
            // Extract keywords and create targeted searches
            const keywords = extractKeywords(query, 5);
            const searches = [
                `${query} evidence statistics data`,
                `${query} research study findings`,
                ...keywords.map(keyword => `${keyword} ${query} facts`)
            ];

            // Perform multiple searches and combine results
            const searchPromises = searches.slice(0, 3).map(searchQuery => 
                searchForEvidence(searchQuery, Math.ceil(numResults / 3))
            );

            const searchResults = await Promise.allSettled(searchPromises);
            
            searchResults.forEach(result => {
                if (result.status === 'fulfilled') {
                    results = results.concat(result.value);
                }
            });

            // Remove duplicates and limit results
            const uniqueResults = results.filter((result, index, self) => 
                index === self.findIndex(r => r.link === result.link)
            );
            
            results = uniqueResults.slice(0, numResults);
        } else {
            // General search
            results = await searchForEvidence(searchQuery, numResults);
        }

        // Format results
        const formattedResults = results.map(result => ({
            title: result.title || 'No title',
            link: result.link || '',
            snippet: result.snippet || 'No description available',
            source: result.displayLink || new URL(result.link || '').hostname
        }));

        return res.status(200).json({
            success: true,
            query: searchQuery,
            results: formattedResults,
            totalResults: formattedResults.length
        });

    } catch (error) {
        console.error('Search function error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : 'Search failed'
        });
    }
}
