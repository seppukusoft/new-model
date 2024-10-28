document.addEventListener("DOMContentLoaded", async function () {
    const dataUrl = "https://projects.fivethirtyeight.com/polls/data/president_polls.csv";
    const weightsUrl = "https://raw.githubusercontent.com/seppukusoft/538-bias-marker/main/list.json";
    const url = 'https://api.the-odds-api.com/v4/sports/politics_us_presidential_election_winner/odds?regions=us&oddsFormat=decimal&apiKey=11ccde4b13434a75e81719ffb34a6b38';
    const electoralVotesMapping = {
      "Alabama": 9, "Alaska": 3, "Arizona": 11, "Arkansas": 6, "California": 54, "Colorado": 10, "Connecticut": 7, "Delaware": 3, "District of Columbia": 3,
      "Florida": 30, "Georgia": 16, "Hawaii": 4, "Idaho": 4, "Illinois": 19, "Indiana": 11, "Iowa": 6, "Kansas": 6, "Kentucky": 8, "Louisiana": 8, "Maine": 2,
      "Maine CD-1": 1, "Maine CD-2": 1, "Maryland": 10, "Massachusetts": 11, "Michigan": 15, "Minnesota": 10, "Mississippi": 6, "Missouri": 10, "Montana": 4,
      "Nebraska": 4, "Nebraska CD-2": 1, "Nevada": 6, "New Hampshire": 4, "New Jersey": 14, "New Mexico": 5, "New York": 28, "North Carolina": 16, "North Dakota": 3,
      "Ohio": 17, "Oklahoma": 7, "Oregon": 8, "Pennsylvania": 19, "Rhode Island": 4, "South Carolina": 9, "South Dakota": 3, "Tennessee": 11, "Texas": 40,
      "Utah": 6, "Vermont": 3, "Virginia": 13, "Washington": 12, "West Virginia": 4, "Wisconsin": 10, "Wyoming": 3
    };
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
    let data = null, weights = null, x = 15, y = 0; 
    let swingAdjustment = 0; 
    const excludedPollIds = [88555, 88556, 88594, 88383, 88627, 88643, 88626, 88591, 88630, 88468, 88538, 88555, 88630, 88756, 88731, 88807, 88643, 88817, 88911, 88836, 88687, 88808, 88876];
    let bettingOdds = null, USProbStore = [];
    let pollCounts = {};
    let marginStore = {}, probabilityStore = {}, USWinStore = {}, plotStore = {};    

    async function fetchPollsterWeights() {
        if (weights) {
            return weights;
        }
        const response = await fetch(weightsUrl);
        const json = await response.json();
        weights = json[0];
        return json[0];
    }

    async function fetchBettingOdds() {
        if (bettingOdds) {
            return bettingOdds;
        }
        try {
            const response = await fetch(url);
            const data = await response.json();
            if (data.length > 0 && data[0].bookmakers && data[0].bookmakers.length > 0) {
                const outcomes = data[0].bookmakers[0].markets[0].outcomes;
                const harrisOutcome = outcomes.find(outcome => outcome.name === "Kamala Harris");
                const trumpOutcome = outcomes.find(outcome => outcome.name === "Donald Trump");
                
                let harrisProbability = 0;
                let trumpProbability = 0;
    
                if (harrisOutcome) {
                    harrisProbability = (1 / harrisOutcome.price) * 100;
                }
                if (trumpOutcome) {
                    trumpProbability = (1 / trumpOutcome.price) * 100;
                }
    
                bettingOdds = { harrisProbability, trumpProbability };
                return bettingOdds;
            } 
        } catch (error) {
            return null;
        }
    }

    async function getAndFilterData(url, daysBack) {
        if (daysBack == 0) {
            if (data) {
                return data;
            }
        }
        const response = await fetch(url);
        const csvText = await response.text();
        let initData = Papa.parse(csvText, { header: true, dynamicTyping: true }).data.filter(d => d.state);
        
        const now = new Date();
        const daysAgo = new Date();
        daysAgo.setDate((now.getDate() - daysBack) - (x));

        let timeData = initData.filter(d => {
            const pollDate = new Date(d.end_date); 
            return pollDate >= daysAgo && pollDate <= now && !excludedPollIds.includes(d.poll_id);
        });

        let exData = timeData.filter(d => 
            d.candidate_name.toLowerCase() !== "joe biden" &&
            d.candidate_name.toLowerCase() !== "robert f. kennedy" &&
            d.candidate_name.toLowerCase() !== "gretchen whitmer" &&
            d.candidate_name.toLowerCase() !== "josh shapiro" &&
            d.candidate_name.toLowerCase() !== "shiva ayyadurai" &&
            (!d.sponsor_candidate || d.sponsor_candidate.toLowerCase() !== "donald trump") &&
            (!d.sponsor_candidate || d.sponsor_candidate.toLowerCase() !== "kamala harris")
        );

        let filteredData = exData.map(poll => {
            const pollsterWeight = getWeight(poll.pollster, weights);
            const sponsorWeight = getWeight(poll.sponsor, weights);
            let voterTypeWeight = poll.population && poll.population.toLowerCase() === 'lv' ? 1 : 0.5;
            const sampleSizeWeight = Math.sqrt(poll.sample_size || 1) * 1.25;
            const finalWeight = Math.min(pollsterWeight, sponsorWeight) * voterTypeWeight * sampleSizeWeight;
            return { ...poll, weightedPct: poll.pct * finalWeight };
        });

        filteredData.forEach(poll => {
            const state = poll.state;
            if (state) {
                pollCounts[state] = (pollCounts[state] || 0) + 1;
            }
        });

        const { harrisProbability, trumpProbability } = bettingOdds;
        const oddsWeight = 0.3;
        const pollsWeight = 0.7; 
        filteredData = filteredData.map(poll => {
            let adjustedPct = poll.weightedPct;
            if (poll.candidate_name === 'Kamala Harris') {
                adjustedPct = (oddsWeight * harrisProbability) + (pollsWeight * poll.weightedPct);
                if (poll.candidate_name === 'Kamala Harris' && poll.state === 'Michigan') {
                    adjustedPct -= 12; 
                }
            } else if (poll.candidate_name === 'Donald Trump') {
                adjustedPct = (oddsWeight * trumpProbability) + (pollsWeight * poll.weightedPct);
            }
            if (poll.candidate_name === 'Jill Stein' && poll.state === 'Michigan') {
                adjustedPct += 12;  
            }
            return { ...poll, adjustedPct };
        });

    
        
        let candidatesData = Array.from(d3.group(filteredData, d => d.candidate_name), ([name, group]) => ({
            name, 
            percentage: d3.mean(group, d => d.adjustedPct)
        }))

        const totalPercentage = d3.sum(candidatesData, d => d.percentage);
        candidatesData.forEach(candidate => {
            candidate.percentage = (candidate.percentage / totalPercentage) * 100;
        });

        candidatesData = candidatesData.filter(candidate => candidate.percentage >= 0.15);
        data = { polls: filteredData, candidates: candidatesData };
        return data;
    }

    function getWeight(name, weights) {
        if (!name) return 1;
        if (weights.red.includes(name)) return 0.33;
        if (weights.leanred.includes(name) || weights.leanblue.includes(name)) return 0.75;
        if (weights.blue.includes(name)) return 0.33;
        if (weights.unreliable.includes(name)) return 0.2;
        if (weights.relmissing.includes(name)) return 1.2;
        return 1.2;
    }    

    function calculateTotalElectoralVotes(num) {
        const totalElectoralVotes = {};
        Object.keys(electoralVotesMapping).forEach(state => {
            probabilityStore[state] = calculateProbability(state);
            const stateData = data.polls.filter(d => d.state === state);
    
            if (stateData.length > 5) {
                const candidates = d3.group(stateData, d => d.candidate_name);
                if (!candidates || typeof candidates !== 'object') {
                    return;
                }
                const totalAdjustedPct = d3.sum(stateData, d => d.adjustedPct);
                const normalizedCandidates = Array.from(candidates, ([name, group]) => ({
                    name,
                    percentage: (d3.sum(group, d => d.adjustedPct) / totalAdjustedPct) * 100
                })); 
    
                const filteredCandidates = normalizedCandidates.filter(candidate => candidate.percentage >= 0.1);
                let [highestPercentage, secondHighestPercentage] = [-Infinity, -Infinity];
                let [winningCandidate, runnerUpCandidate] = [null, null];
    
                filteredCandidates.forEach(candidate => {
                    let percentage = candidate.percentage;
                    if (candidate.name === "Donald Trump") {
                        percentage += swingAdjustment;
                    }
                    if (percentage > highestPercentage) {
                        [secondHighestPercentage, runnerUpCandidate] = [highestPercentage, winningCandidate];
                        [highestPercentage, winningCandidate] = [percentage, candidate.name];
                    } else if (percentage > secondHighestPercentage) {
                        [secondHighestPercentage, runnerUpCandidate] = [percentage, candidate.name];
                    }
                });
    
                if (winningCandidate && secondHighestPercentage !== -Infinity) {
                    const margin = highestPercentage - secondHighestPercentage;
                    const marginForHarris = winningCandidate === 'Donald Trump' ? -margin : Math.abs(margin);
                    updateStateDisplay(state, marginForHarris, electoralVotesMapping[state], winningCandidate, num);
                    totalElectoralVotes[winningCandidate] = (totalElectoralVotes[winningCandidate] || 0) + electoralVotesMapping[state];
                }
            } else {
                handleDefaultStateAllocation(state, totalElectoralVotes, num);
            }
        });
        return totalElectoralVotes;
    }

    
    function calculateProbability(state, iterations = 10000) {
        const statePolls = data.polls.filter(poll => poll.state === state);
        const candidatesMap = new Map();
        statePolls.forEach(poll => {
            if (!candidatesMap.has(poll.candidate_name)) {
                candidatesMap.set(poll.candidate_name, { adjustedPct: 0, count: 0 });
            }
            const candidateData = candidatesMap.get(poll.candidate_name);
            candidateData.adjustedPct += poll.adjustedPct;
            candidateData.count += 1;
        });

        const candidates = Array.from(candidatesMap.entries()).map(([name, data]) => ({
            name,
            adjustedPct: data.adjustedPct / data.count 
        }));
        if (candidates.length === 0) {
            return {}; 
        }
        const totalAdjustedPct = candidates.reduce((sum, candidate) => sum + candidate.adjustedPct, 0);
        candidates.forEach(candidate => {
            candidate.adjustedPct = (candidate.adjustedPct / totalAdjustedPct) * 100;
        });

        const results = candidates.reduce((acc, { name }) => ({ ...acc, [name]: 0 }), {});    
        for (let i = 0; i < iterations; i++) {
            let odd = 0;
            const randomResults = candidates.map(candidate => {
                if (candidate.name == "Kamala Harris") {
                    odd = bettingOdds.harrisProbability;
                } else if (candidate.name == "Donald Trump") {
                    odd = bettingOdds.trumpProbability;
                }
                const variation = (Math.random() - 0.33) * 20; 
                const adjustedVote = Math.max(0, Math.min(100, candidate.adjustedPct + variation));
                return {
                    name: candidate.name,
                    result: adjustedVote 
                };
            });
            const winner = randomResults.reduce((prev, curr) => (curr.result > prev.result ? curr : prev));
            results[winner.name] += 1; 
        }
        const winProbabilities = Object.fromEntries(
            Object.entries(results).map(([name, count]) => [name, (count / iterations) * 100])
        );
        probabilityStore[state] = "Win Probability: " + 
        Object.entries(winProbabilities) 
            .filter(([name, prob]) => prob > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([name, prob]) => `${name}: ${Math.round(prob)}%`) 
            .join(", ");
        return winProbabilities; 
    }
    
    function updateStateDisplay(state, margin, electoralVotes, winner, num) {
        marginStore[state] = "Average Margin: " + winner + " +" + Math.abs(margin).toFixed(2) + "%";
        const stateColor = getStateColor(margin);
        const abbState = stateAbbreviations[state];
        applyColor(abbState, stateColor);
        if (num == 1){
            changeDesc(abbState, electoralVotes);
            let hp = probabilityStore[state]["Kamala Harris"];
            let tp = probabilityStore[state]["Donald Trump"];
            oddsDesc(abbState, hp, tp)
        } 
    }

    function getStateColor(margin) {
        if (margin > 8) return "solidD";
        if (margin > 4.5) return "likelyD";
        if (margin > 2) return "leanD";
        if (margin > 0) return "tiltD";
        if (margin > -2) return "tiltR";
        if (margin > -4.5) return "leanR";
        if (margin > -8) return "likelyR";
        return "solidR";
    }

    function handleDefaultStateAllocation(state, totalElectoralVotes, num) {
        const stateElectoralVotes = electoralVotesMapping[state];
        const abbState = stateAbbreviations[state];
        let stateColor, candidate;
        let hp;
        let tp;

        if (["Colorado", "California", "Connecticut", "District of Columbia", "Hawaii", "Minnesota", "New Hampshire", "Illinois", "Rhode Island", "New Jersey", "New York", "Oregon", "Virginia", "Vermont", "Washington", "Maine", "Maine CD-1", "New Mexico", "Massachusetts", "Delaware", "Maryland", "Nebraska CD-2"].includes(state)) {
            stateColor = state === "Nebraska CD-2" ? "likelyD" : (state === "Minnesota" ? "likelyD" : "solidD");
            candidate = "Kamala Harris";
            if (num == 1){
            hp = abbState === "NE2" ? 85 : (abbState === "MN" ? 85 : Math.round(Math.random() * 2) + 98);
			tp = abbState === "NE2" ? 15 : 100 - hp;
            }
        } else if (["Alabama", "Arkansas", "Alaska", "Idaho", "Iowa", "Indiana", "Kansas", "Kentucky", "Louisiana", "Montana", "North Dakota", "Mississippi", "Missouri", "Maine CD-2", "Nebraska", "Ohio", "Oklahoma", "South Carolina", "South Dakota", "Tennessee", "Utah", "West Virginia", "Wyoming"].includes(state)) {
            stateColor = state === "Alaska" ? "likelyR" : (state === "Maine CD-2" ? "leanR" : "solidR");
            candidate = "Donald Trump";
            if (num == 1){
            tp = abbState === "AK" ? 90 : (state === "ME2" ? 80 :Math.round(Math.random() * 2) + 98);
			hp = abbState === "AK" ? 10 : (state === "ME2" ? 20 :100 - tp);
            }
        } else {
            return;
        }

        applyColor(abbState, stateColor);
        if (num == 1){
            changeDesc(abbState, stateElectoralVotes);
            oddsDesc(abbState, hp, tp) 
            probabilityStore[state] = {
                "Kamala Harris": hp,
                "Donald Trump": tp
            };
        }        
        totalElectoralVotes[candidate] = (totalElectoralVotes[candidate] || 0) + stateElectoralVotes;
    }

    function calculateElectionWinProbability(iterations = 50000) {
        if (USWinStore[x]) {
            return USWinStore[x];
        }
        const electionResults = {}; 
        const candidates = Object.keys(probabilityStore[Object.keys(probabilityStore)[0]] || {});
        candidates.forEach(candidate => electionResults[candidate] = 0);
    
        for (let sim = 0; sim < iterations; sim++) {
            const electoralVoteCount = {}; 
            candidates.forEach(candidate => electoralVoteCount[candidate] = 0);
            Object.keys(electoralVotesMapping).forEach(state => {
                const winProbabilities = { ...probabilityStore[state] };
                winProbabilities["Donald Trump"] *= 1.6; 
                const totalProbability = Object.values(winProbabilities).reduce((sum, prob) => sum + prob, 0);
                candidates.forEach(candidate => winProbabilities[candidate] = (winProbabilities[candidate] / totalProbability) * 100);
    
                let randomValue = Math.random() * 100;
                let cumulativeProbability = 0;
                let winner = candidates[0];

                for (let candidate of candidates) {
                    cumulativeProbability += winProbabilities[candidate];
                    if (randomValue <= cumulativeProbability) {
                        winner = candidate;
                        break;
                    }
                }
                electoralVoteCount[winner] += electoralVotesMapping[state];
            });

            for (let candidate of candidates) {
                if (electoralVoteCount[candidate] >= 270) {
                    electionResults[candidate] += 1; 
                    break;
                }
            }
        }
        const totalWins = Object.values(electionResults).reduce((sum, wins) => sum + wins, 0);
        const finalWinProbabilities = {};
        candidates.forEach(candidate => {
                finalWinProbabilities[candidate] = (electionResults[candidate] / totalWins) * 100;
        });
        USProbStore[x] = finalWinProbabilities;
        return finalWinProbabilities; 
    }
    
    


    function populateDropdown(data) {
        const dropdown = d3.select("#stateDropdown");
        const states = [...new Set(data.map(d => d.state).filter(Boolean))];
        const filteredStates = states.filter(state => {
            const stateData = data.filter(d => d.state === state); 
            return stateData.length >= 20; 
        });
        filteredStates.sort((a, b) => a.localeCompare(b));
        filteredStates.forEach(state => {
            dropdown.append("option")
                .attr("value", state)
                .text(state);
        });
        dropdown.on("change", function () {
            const selectedState = document.getElementById("stateDropdown").value;

            displayResults(selectedState);
        });
    }

    function displayResults(selectedState) {
        if (selectedState === "US") {
            d3.select("#probability").text("Win Probability: " + USWinStore[x]);
            document.getElementById("voteShare").style.display = "none";
            document.getElementById("margin").style.display = "none";
            return;
        }
        document.getElementById("voteShare").style.display = "block";
        document.getElementById("margin").style.display = "block";
        const stateData = data.polls.filter(d => d.state === selectedState);
        if (stateData.length >= 20) {
            const candidates = d3.group(stateData, d => d.candidate_name);
            let candidatesData = Array.from(candidates)
                .map(([name, polls]) => {
                    const percentage = d3.mean(polls, d => d.adjustedPct); 
                    if (percentage > 0) {
                        return { name, percentage: percentage.toFixed(2) };
                    }
                    return null;
                })
                .filter(c => c !== null) 
                .sort((a, b) => b.percentage - a.percentage);
            const totalPercentage = d3.sum(candidatesData, d => d.percentage);
            candidatesData.forEach(candidate => {
                candidate.percentage = (candidate.percentage / totalPercentage) * 100;
            });
            const voteShareText = candidatesData
                .map(c => `${c.name}: ${c.percentage.toFixed(2)}%`)
                .join(", ");
            d3.select("#voteShare").text(`Popular Vote Estimate: ${voteShareText}`);
            d3.select("#margin").text(marginStore[selectedState]);
            const finalProb = Object.entries(probabilityStore[selectedState])
                .filter(([name, prob]) => prob > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([name, prob]) => `${name}: ${prob.toFixed(2)}%`) 
                .join(", ");
            d3.select("#probability").text("Win Probability: " + finalProb);
        }
        d3.select("#resultsState").text(`Data for: ${selectedState}`);
        
    }
    
    function displayEV (totalEVDisplay) {
        document.getElementById("totalElectoralVotes").innerText = `EV: ${Object.entries(totalEVDisplay)
            .map(([candidate, votes]) => `${candidate}: ${votes}`)
            .join(", ")}`;
    }

    function handleSwingAdjustment() {
        document.getElementsByClassName("test").innerHTML = "";
        const swingInput = document.getElementById("swingInput");
        swingAdjustment = parseFloat(swingInput.value) || 0; 
        displayEV(calculateTotalElectoralVotes(0));
        mapRefresh();
    }
    document.getElementById("swingInput").addEventListener("input", handleSwingAdjustment);

    function updateSim () {
        swingAdjustment = 0;
        d3.select("#totalElectoralVotes").text(`Loading...`);
        x = document.getElementById("xDropdown").value;
        document.getElementById("stateDropdown").innerHTML = "";
        document.getElementById("stateDropdown").value = "US";
        d3.select("#stateDropdown").append("option").attr("value", "US").text("US");
        data = null;
        probabilityStore = {};
        marginStore = {};
        initSim();
        d3.select("#resultsState").text(`Data for: US`);
        d3.select("#probability").text(`Win Probability:`);
    }
    document.getElementById("xDropdown").addEventListener("change", updateSim);

    async function initSim() {
        document.getElementById("voteShare").style.display = "none";
        document.getElementById("margin").style.display = "none";
        document.getElementById("swingInput").value = 0;
        await fetchPollsterWeights();
        await fetchBettingOdds();
        data = await getAndFilterData(dataUrl, 0);
        let totalEVDisplay = calculateTotalElectoralVotes(1);
        mapRefresh();
        populateDropdown(data.polls);
        displayEV(totalEVDisplay);
        if (!USWinStore[x]) {
            const USWinProb = Object.entries(calculateElectionWinProbability())
                .filter(([name, prob]) => prob > 0)
                .sort((a, b) => b[1] - a[1]) 
                .map(([name, prob]) => `${name}: ${prob.toFixed(2)}%`) 
                .join(", ");
                USWinStore[x] = USWinProb;
        }
        d3.select("#probability").text("Win Probability: " + USWinStore[x]);
        getHistData();
        // runHistCalc(dataUrl, 35);
    }
    document.getElementById("xDropdown").value = x;
    initSim(); 
    
    async function getHistData() {
        let hArr = null;
        let tArr = null;
        let time = (x / 15) - 1;
        fetch('https://raw.githubusercontent.com/seppukusoft/new-model/refs/heads/main/plot.json') 
        .then(response => {
            return response.json(); 
        })
        .then(data => {
            hArr = data[time].harris.map(num => parseFloat(num).toFixed(2));
            tArr = data[time].trump.map(num => parseFloat(num).toFixed(2));
            hArr.unshift("\"" + USProbStore[x]["Kamala Harris"].toFixed(2) + "\"");
            tArr.unshift("\"" + USProbStore[x]["Donald Trump"].toFixed(2) + "\"");
            let dateArray = [];
            let currentDate = new Date();
            currentDate = new Date(currentDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
            for (let i = 0; i < hArr.length; i++) {
                let year = currentDate.getFullYear();
                let month = (currentDate.getMonth() + 1).toString().padStart(2, '0');
                let day = currentDate.getDate().toString().padStart(2, '0');
                dateArray.push(`${year}-${month}-${day}`);
                currentDate.setDate(currentDate.getDate() - 2);
            }
            plotHistData(hArr, tArr, dateArray);
        })
        .catch(error => {
            console.error("There was a problem with the fetch operation:", error);
        });
    }

    function plotHistData (harrisArray, trumpArray, dateArray) {
        var harris = {
            x: dateArray,          
            y: harrisArray,          
            type: 'scatter',
            line: {shape: 'spline', color: 'blue'},
            name: 'Harris'        
          };
                    
          var trump = {          
            x: dateArray,          
            y: trumpArray,          
            type: 'scatter',
            line: {shape: 'spline', color: 'red'},
            name: 'Trump'          
          };    
          
          var layout = {
            title: 'Win Probability by Date',
            font: {
                family: 'Verdana',            
                size: 14,            
                color: '#000000'            
              },
            xaxis: {
                title: 'Date' ,
                linewidth: 2            
              },            
              yaxis: {            
                title: 'Win Probability',
                autorange: false, 
                range:[0, 100],
                linewidth: 2,
                dtick: 10           
              }
          };
          
          var plotData = [harris, trump];        
          Plotly.newPlot('tester', plotData, layout, {displaylogo: false}, {responsive: true});
    }

    // async function runHistCalc(dataUrl, y) {
    //     let hArr = [];
    //     let tArr = [];
    //     let plotStore = [];
    
    //     for (let i = 1; i <= y; i++) {
    //         const daysBack = i * 2;
    //         const data = await getAndFilterData(dataUrl, daysBack);
    //         console.log(calculateTotalElectoralVotes(1));
    
    //         const plotProb = Object.entries(plotWinProbability()).filter(([name, prob]) => prob > 0);
    //         plotStore.push(plotProb);
    //         console.log(`Plot data for ${daysBack} days ago:`, plotProb);
    //     }
    
    //     plotStore.forEach((plot) => {
    //         hArr.push(plot[0][1]);
    //         tArr.push(plot[1][1]);
    //     });
    
    //     console.log("Harris probabilities:", hArr);
    //     console.log("Trump probabilities:", tArr);
    //     return { hNum: hArr, tNum: tArr };
    // }
    
    // function plotWinProbability(iterations = 50000) {
    //     const electionResults = {};
    //     const candidates = Object.keys(probabilityStore[Object.keys(probabilityStore)[0]] || {});
    //     candidates.forEach(candidate => electionResults[candidate] = 0);
    
    //     for (let sim = 0; sim < iterations; sim++) {
    //         const electoralVoteCount = {};
    //         candidates.forEach(candidate => electoralVoteCount[candidate] = 0);
    
    //         for (let state in electoralVotesMapping) {
    //             const winProbabilities = { ...probabilityStore[state] };
    //             winProbabilities["Donald Trump"] *= 1.6;
    
    //             const totalProbability = Object.values(winProbabilities).reduce((sum, prob) => sum + prob, 0);
    //             candidates.forEach(candidate => winProbabilities[candidate] = (winProbabilities[candidate] / totalProbability) * 100);
    
    //             let randomValue = Math.random() * 100;
    //             let cumulativeProbability = 0;
    //             let winner = candidates[0];
    
    //             for (let candidate of candidates) {
    //                 cumulativeProbability += winProbabilities[candidate];
    //                 if (randomValue <= cumulativeProbability) {
    //                     winner = candidate;
    //                     break;
    //                 }
    //             }
    //             electoralVoteCount[winner] += electoralVotesMapping[state];
    //         }
    
    //         for (let candidate of candidates) {
    //             if (electoralVoteCount[candidate] >= 270) {
    //                 electionResults[candidate] += 1;
    //                 break;
    //             }
    //         }
    //     }
    
    //     const totalWins = Object.values(electionResults).reduce((sum, wins) => sum + wins, 0);
    //     const finalWinProbabilities = {};
    //     candidates.forEach(candidate => {
    //         finalWinProbabilities[candidate] = (electionResults[candidate] / totalWins) * 100;
    //     });
    
    //     USProbStore[x] = finalWinProbabilities;
    //     return finalWinProbabilities;
    // }

});

document.addEventListener("DOMContentLoaded", function() {
    function removeElement() {
        var element = document.querySelector('a[href="https://simplemaps.com"][title="For evaluation use only."]');
        if (element) {
            element.remove();
        }
    }

    var observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length) {
                removeElement();
            }
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    removeElement();
});
