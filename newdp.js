// Import statements (assuming these are in the HTML file)
// <script src="https://d3js.org/d3.v7.min.js"></script>
// <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.0/papaparse.min.js"></script>

document.addEventListener("DOMContentLoaded", async function () {
    // Constants
    const DATA_URL = "https://projects.fivethirtyeight.com/polls/data/president_polls.csv";
    const WEIGHTS_URL = "https://raw.githubusercontent.com/seppukusoft/538-bias-marker/main/list.json";
    const ELECTORAL_VOTES_MAPPING = {
        "Alabama": 9, "Alaska": 3, "Arizona": 11, "Arkansas": 6, "California": 54, "Colorado": 10,
        "Connecticut": 7, "Delaware": 3, "District of Columbia": 3, "Florida": 30, "Georgia": 16,
        "Hawaii": 4, "Idaho": 4, "Illinois": 19, "Indiana": 11, "Iowa": 6, "Kansas": 6,
        "Kentucky": 8, "Louisiana": 8, "Maine": 2, "Maine CD-1": 1, "Maine CD-2": 1, "Maryland": 10,
        "Massachusetts": 11, "Michigan": 15, "Minnesota": 10, "Mississippi": 6, "Missouri": 10,
        "Montana": 4, "Nebraska": 4, "Nebraska CD-2": 1, "Nevada": 6, "New Hampshire": 4,
        "New Jersey": 14, "New Mexico": 5, "New York": 28, "North Carolina": 16, "North Dakota": 3,
        "Ohio": 17, "Oklahoma": 7, "Oregon": 8, "Pennsylvania": 19, "Rhode Island": 4,
        "South Carolina": 9, "South Dakota": 3, "Tennessee": 11, "Texas": 40, "Utah": 6,
        "Vermont": 3, "Virginia": 13, "Washington": 12, "West Virginia": 4, "Wisconsin": 10, "Wyoming": 3
    };
    const EXCLUDED_POLL_IDS = [88555, 88556, 88594, 88383, 88627, 88643, 88626, 88591, 88630, 88468, 88538, 88555];

    // State
    let data = [];
    let weights = {};
    let x = 15; // Default value for x
    let swingAdjustment = 0;
    let bettingOdds = null;

    // Function to check if URL is reachable
    async function checkURL(url) {
        try {
            return (await fetch(url, { method: 'HEAD' })).ok;
        } catch (error) {
            return false;
        }
    }

    // Function to fetch and parse CSV data
    async function fetchAndParseCSV(url) {
        const response = await fetch(url);
        const csvText = await response.text();
        return Papa.parse(csvText, { header: true, dynamicTyping: true }).data.filter(d => d.state);
    }

    // Function to fetch pollster weights
    async function fetchPollsterWeights(url) {
        const response = await fetch(url);
        const json = await response.json();
        return json[0];
    }

    // Function to fetch betting odds
    async function fetchBettingOdds() {
        if (bettingOdds) return bettingOdds;

        const url = 'https://api.the-odds-api.com/v4/sports/politics_us_presidential_election_winner/odds?regions=us&oddsFormat=decimal&apiKey=e789a974466d0cca49769df8a8ff04f6';

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.length > 0 && data[0].bookmakers && data[0].bookmakers.length > 0) {
                const outcomes = data[0].bookmakers[0].markets[0].outcomes;
                const kamalaOutcome = outcomes.find(outcome => outcome.name === "Kamala Harris");
                const trumpOutcome = outcomes.find(outcome => outcome.name === "Donald Trump");

                if (kamalaOutcome && trumpOutcome) {
                    const kamalaOdds = kamalaOutcome.price;
                    const trumpOdds = trumpOutcome.price;

                    const kamalaProbability = (1 / kamalaOdds) * 100;
                    const trumpProbability = (1 / trumpOdds) * 100;

                    bettingOdds = { kamalaProbability, trumpProbability };
                    return bettingOdds;
                }
            }
            console.error("Betting odds data is missing or undefined.");
            return null;
        } catch (error) {
            console.error('Error fetching or processing betting odds:', error);
            return null;
        }
    }

    // Initialize data and weights
    async function initializeData() {
        if (await checkURL(DATA_URL)) {
            data = await fetchAndParseCSV(DATA_URL);
            weights = await fetchPollsterWeights(WEIGHTS_URL);
            bettingOdds = await fetchBettingOdds();
            return true;
        }
        console.error("CSV URL is not reachable");
        return false;
    }

    // Main initialization
    if (await initializeData()) {
        setMapOdds();
        populateDropdown(data);
        displayTotalElectoralVotes(calculateTotalElectoralVotes(data));
    }

    // Event listeners
    document.getElementById("xDropdown").addEventListener("change", updateElectoralVotes);
    document.getElementById("swingInput").addEventListener("input", handleSwingAdjustment);

    // ... (Continued from Part 1)

// Helper function to get weight based on the category (pollster/sponsor)
function getWeight(name, weights) {
    if (!name) return 1;
    if (weights.red.includes(name)) return 0.3;
    if (weights.leanred.includes(name) || weights.leanblue.includes(name)) return 0.5;
    if (weights.blue.includes(name)) return 0.3;
    if (weights.unreliable.includes(name)) return 0.1;
    if (weights.relmissing.includes(name)) return 1.2;
    return 1.2;
}

// Calculate weighted percentages based on pollster, sponsor, and voter type weights
function calculateWeightedPolls(pollData, weights) {
    return pollData.map(poll => {
        const pollsterWeight = getWeight(poll.pollster, weights);
        const sponsorWeight = getWeight(poll.sponsor, weights);
        const voterTypeWeight = poll.population && poll.population.toLowerCase() === 'lv' ? 1.5 : 0.5;
        const finalWeight = Math.min(pollsterWeight, sponsorWeight) * voterTypeWeight;
        return { ...poll, weightedPct: poll.pct * finalWeight };
    });
}

// Filter data based on date range
function filterByRecentDates(data, daysAgo) {
    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - daysAgo));
    return data.filter(d => {
        const pollDate = new Date(d.end_date);
        return pollDate >= cutoffDate && pollDate <= now && !EXCLUDED_POLL_IDS.includes(d.poll_id);
    });
}

// Calculate win probability using Monte Carlo simulations
function calculateWinProbability(candidates, iterations = 100000) {
    if (!bettingOdds) {
        console.error("Could not retrieve betting odds. Simulation aborted.");
        return null;
    }

    const { kamalaProbability, trumpProbability } = bettingOdds;
    const candidatesWithOdds = candidates.map(candidate => ({
        ...candidate,
        bettingOdds: candidate.name === 'Kamala Harris' ? kamalaProbability :
                     candidate.name === 'Donald Trump' ? trumpProbability :
                     candidate.percentage
    }));

    const results = candidatesWithOdds.reduce((acc, { name }) => ({ ...acc, [name]: 0 }), {});

    for (let i = 0; i < iterations; i++) {
        const randomResults = candidatesWithOdds.map(candidate => ({
            name: candidate.name,
            result: candidate.percentage + (Math.random() - 0.45) * candidate.bettingOdds
        }));
        const winner = randomResults.reduce((prev, curr) => (curr.result > prev.result ? curr : prev));
        results[winner.name]++;
    }

    return Object.fromEntries(
        Object.entries(results).map(([name, count]) => [name, (count / iterations) * 100])
    );
}

// Calculate total electoral votes for all states
function calculateTotalElectoralVotes(data) {
    const totalElectoralVotes = {};
    const filteredData = data.filter(d => !EXCLUDED_POLL_IDS.includes(d.poll_id));

    Object.keys(ELECTORAL_VOTES_MAPPING).forEach(state => {
        const stateData = filteredData.filter(d => d.state === state);
        const recentData = filterByRecentDates(stateData, x);
        const weightedRecentData = calculateWeightedPolls(recentData, weights);

        if (recentData.length > 0) {
            const candidates = d3.group(weightedRecentData, d => d.candidate_name);
            let [highestPercentage, secondHighestPercentage] = [-Infinity, -Infinity];
            let [winningCandidate, runnerUpCandidate] = [null, null];

            candidates.forEach((candidateData, candidateName) => {
                let percentage = d3.mean(candidateData, d => d.pct);
                if (candidateName === "Donald Trump") {
                    percentage += swingAdjustment;
                }
                if (percentage > highestPercentage) {
                    [secondHighestPercentage, runnerUpCandidate] = [highestPercentage, winningCandidate];
                    [highestPercentage, winningCandidate] = [percentage, candidateName];
                } else if (percentage > secondHighestPercentage) {
                    [secondHighestPercentage, runnerUpCandidate] = [percentage, candidateName];
                }
            });

            if (winningCandidate && secondHighestPercentage !== -Infinity) {
                const margin = highestPercentage - secondHighestPercentage;
                const marginForHarris = winningCandidate === 'Donald Trump' ? -margin : Math.abs(margin);
                updateStateDisplay(state, marginForHarris, ELECTORAL_VOTES_MAPPING[state]);
                totalElectoralVotes[winningCandidate] = (totalElectoralVotes[winningCandidate] || 0) + ELECTORAL_VOTES_MAPPING[state];
            }
        } else {
            handleDefaultStateAllocation(state, totalElectoralVotes);
        }
    });

    return totalElectoralVotes;
}

// Helper function to update state display
function updateStateDisplay(state, margin, electoralVotes) {
    const stateColor = getStateColor(margin);
    const abbState = getStateAbbreviation(state);
    applyColor(abbState, stateColor);
    changeDesc(abbState, electoralVotes);
    oddsDesc(abbState, newOdds);
}

// Helper function to get state color based on margin
function getStateColor(margin) {
    if (margin > 8) return "solidD";
    if (margin > 5) return "likelyD";
    if (margin > 2) return "leanD";
    if (margin > 0) return "tiltD";
    if (margin > -2) return "tiltR";
    if (margin > -5) return "leanR";
    if (margin > -8) return "likelyR";
    return "solidR";
}

// Helper function to handle default state allocation
function handleDefaultStateAllocation(state, totalElectoralVotes) {
    const stateElectoralVotes = ELECTORAL_VOTES_MAPPING[state];
    const abbState = getStateAbbreviation(state);
    let stateColor, candidate;

    if (["Colorado", "Connecticut", "District of Columbia", "Hawaii", "Illinois", "Rhode Island", "New Jersey", "New York", "Oregon", "Vermont", "Washington", "Maine", "Maine CD-1", "New Mexico", "Massachusetts", "Delaware", "Maryland", "Nebraska CD-2"].includes(state)) {
        stateColor = state === "Nebraska CD-2" ? "likelyD" : "solidD";
        candidate = "Kamala Harris";
    } else if (["Alabama", "Arkansas", "Alaska", "Idaho", "Iowa", "Indiana", "Kansas", "Kentucky", "Louisiana", "Montana", "North Dakota", "Mississippi", "Missouri", "Maine CD-2", "Oklahoma", "South Carolina", "South Dakota", "Tennessee", "Utah", "West Virginia", "Wyoming"].includes(state)) {
        stateColor = state === "Alaska" ? "likelyR" : (state === "Maine CD-2" ? "leanR" : "solidR");
        candidate = "Donald Trump";
    } else {
        return; // Skip if not in either list
    }

    applyColor(abbState, stateColor);
    changeDesc(abbState, stateElectoralVotes);
    oddsDesc(abbState, newOdds);
    totalElectoralVotes[candidate] = (totalElectoralVotes[candidate] || 0) + stateElectoralVotes;
}

// ... (Continued from Part 2)

// Populate dropdown menus
function populateDropdown(data) {
    const dropdown = d3.select("#stateDropdown");
    const states = [...new Set(data.map(d => d.state).filter(Boolean))];
    const filteredStates = states.filter(state => {
        const stateData = data.filter(d => d.state === state);
        const recentData = filterByRecentDates(stateData, x);
        return recentData.length >= 20;
    });
    
    filteredStates.sort((a, b) => a.localeCompare(b));
    
    dropdown.selectAll("option").remove();
    dropdown.append("option").attr("value", "select").text("--Select--");
    filteredStates.forEach(state => {
        dropdown.append("option").attr("value", state).text(state);
    });
    
    updateResults("select", 1);
    dropdown.on("change", function() {
        updateResults(this.value, 1);
    });
}

// Set up time span selection dropdown
function populateTimeDropdown() {
    d3.select("#xDropdown").on("change", function() {
        x = parseInt(this.value, 10);
        const selectedState = document.getElementById("stateDropdown").value;
        fetchAndUpdateResults(selectedState);
    });
}

// Fetch and update results based on new time span
async function fetchAndUpdateResults(selectedState) {
    const filteredData = await fetchAndParseCSV(DATA_URL);
    data = filterByRecentDates(filteredData, x);
    updateStateDropdown();
    updateResults(selectedState, 1);
    setMapOdds();
    displayTotalElectoralVotes(calculateTotalElectoralVotes(data));
}

// Update state dropdown based on filtered data
function updateStateDropdown() {
    const dropdown = document.getElementById("stateDropdown");
    dropdown.innerHTML = "<option value=''>--Select--</option>";
    
    const pollCounts = countPollsByState(data);
    const statesWithSufficientPolls = Object.keys(pollCounts).filter(state => pollCounts[state] >= 20);
    
    statesWithSufficientPolls.forEach(state => {
        const option = document.createElement("option");
        option.value = state;
        option.text = state;
        dropdown.appendChild(option);
    });
}

// Count polls by state
function countPollsByState(data) {
    return data.filter(poll => !EXCLUDED_POLL_IDS.includes(poll.poll_id))
               .reduce((acc, poll) => {
                   if (poll.state) {
                       acc[poll.state] = (acc[poll.state] || 0) + 1;
                   }
                   return acc;
               }, {});
}

// Update results for a selected state
async function updateResults(selectedState, num) {
    let filteredData = data.filter(d => d.state === selectedState && !EXCLUDED_POLL_IDS.includes(d.poll_id));
    filteredData = filterByRecentDates(filteredData, x).filter(d => 
        !["joe biden", "robert f. kennedy", "gretchen whitmer", "josh shapiro"].includes(d.candidate_name.toLowerCase())
    );

    if (filteredData.length === 0) return;

    const odds = await fetchBettingOdds();
    if (!odds) {
        console.error("Could not retrieve betting odds.");
        return;
    }

    const { kamalaProbability, trumpProbability } = odds;
    const weightedData = calculateWeightedPolls(filteredData, weights);
    
    let candidatesData = Array.from(d3.group(weightedData, d => d.candidate_name), ([name, group]) => ({
        name, 
        percentage: d3.mean(group, d => d.weightedPct)
    })).filter(candidate => candidate.percentage >= 0.15);

    const totalPercentage = d3.sum(candidatesData, d => d.percentage);
    candidatesData.forEach(candidate => {
        candidate.percentage = (candidate.percentage / totalPercentage) * 100;
    });

    const oddsWeight = 0.05;
    const pollsWeight = 0.95;

    candidatesData = candidatesData.map(candidate => {
        if (candidate.name === 'Kamala Harris') {
            return { 
                ...candidate, 
                bettingOdds: kamalaProbability,
                adjustedPercentage: (oddsWeight * kamalaProbability) + (pollsWeight * candidate.percentage)
            };
        } else if (candidate.name === 'Donald Trump') {
            return { 
                ...candidate, 
                bettingOdds: trumpProbability,
                adjustedPercentage: (oddsWeight * trumpProbability) + (pollsWeight * candidate.percentage)
            };
        } else {
            return { 
                ...candidate, 
                bettingOdds: candidate.percentage,
                adjustedPercentage: candidate.percentage
            };
        }
    });

    return num === 1 ? displayText(candidatesData, selectedState) : candidatesData;
}

// Display text results
function displayText(candidatesData, selectedState) {
    const voteShareText = candidatesData.map(candidate => `${candidate.name}: ${candidate.adjustedPercentage.toFixed(2)}%`).join(", ");
    d3.select("#voteShare").text(`Popular Vote Estimate: ${voteShareText}`);

    const winProbabilities = calculateWinProbability(candidatesData);
    const probabilityText = Object.entries(winProbabilities)
        .filter(([_, prob]) => prob > 0.5)
        .map(([candidate, prob]) => `${candidate}: ${prob.toFixed(2)}%`).join(", ");
    d3.select("#probability").text(`Win Probability: ${probabilityText}`);

    displayTotalElectoralVotes(calculateTotalElectoralVotes(data));
    d3.select("#resultsState").text(`Data for: ${selectedState}`);
    return winProbabilities;
}

// Display the total electoral votes
function displayTotalElectoralVotes(totalElectoralVotes) {
    d3.select("#totalElectoralVotes").text(
        `EV: ${Object.entries(totalElectoralVotes)
            .map(([candidate, votes]) => `${candidate}: ${votes}`)
            .join(", ")}`
    );
}

// Handle swing adjustment
function handleSwingAdjustment() {
    document.getElementsByClassName("test").innerHTML = "";
    const swingInput = document.getElementById("swingInput");
    swingAdjustment = parseFloat(swingInput.value) || 0;
    displayTotalElectoralVotes(calculateTotalElectoralVotes(data));
    mapRefresh();
}

// Helper function to get state abbreviation
function getStateAbbreviation(stateName) {
    const stateAbbreviations = {
        "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
        "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
        "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
        "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
        "Maine": "ME", "Maine CD-1": "ME1", "Maine CD-2": "ME2", "Maryland": "MD",
        "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
        "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nebraska CD-2": "NE2",
        "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
        "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
        "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
        "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
        "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
        "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
    };
    return stateAbbreviations[stateName];
}

// Initialize the application
populateTimeDropdown();
initializeData();
// ... (Any other initialization code)solidR": "#d22532", "likelyR": "#ff5865", "leanR": "#ff8b98", "tiltR": "#cf8980",
        "tiltD": "#949bb3", "leanD": "#90acfc", "likelyD": "#577ccc", "solidD": "#244999"
    };
    
    if (["ME1", "ME2", "NE2"].includes(state)) {
        simplemaps_usmap_mapdata.locations[state].color = colorMapping[newColor];
    } else if (state) {
        simplemaps_usmap_mapdata.state_specific[state].color = colorMapping[newColor];
    }
}

function mapRefresh() {
    simplemaps_usmap.refresh();
}

function changeDesc(state, num) {
    const target = ["ME1", "ME2", "NE2"].includes(state) ? 
        simplemaps_usmap_mapdata.locations[state] : 
        simplemaps_usmap_mapdata.state_specific[state];
    
    if (target) {
        target.description = `${num} Electoral Vote(s)`;
    }
}

function oddsDesc(state, hPercent, tPercent) {
    const target = ["ME1", "ME2", "NE2"].includes(state) ? 
        simplemaps_usmap_mapdata.locations[state] : 
        simplemaps_usmap_mapdata.state_specific[state];
    
    if (target && !isNaN(hPercent) && !isNaN(tPercent)) {
        target.description += `<br>Harris: ${hPercent} out of 100<br>Trump: ${tPercent} out of 100`;
    }
    mapRefresh();
}

// Initialize the application
populateTimeDropdown();
initializeData();
// ... (Any other initialization code)