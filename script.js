let map;
let markers = {};
let activePopup = null;

async function loadData() {
    const response = await fetch('data.tsv');
    const text = await response.text();
    const rows = text.split('\n')
        .filter(row => row.trim())
        .slice(1); // Skip header
    
    return rows.map(row => {
        const [name, start, end, img, lat, lon, desc] = row.split('\t').map(field => field.trim());
        
        // Skip invalid rows
        if (!name || !start || !end || !lat || !lon) {
            console.warn('Skipping invalid row:', row);
            return null;
        }

        // Convert coordinates directly since they're now separate
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        
        // Skip if coordinates are invalid
        if (isNaN(latitude) || isNaN(longitude)) {
            console.warn('Invalid coordinates for:', name);
            return null;
        }

        return {
            name,
            start: new Date(start),
            end: new Date(end),
            img: img || 'default.jpg',
            lat: latitude,
            lon: longitude,
            desc: desc || ''
        };
    }).filter(festival => festival !== null);
}

// Add this function to assign colors based on chronological order
function getFestivalColor(index, totalFestivals) {
    const hue = (360 / totalFestivals) * index;
    return `hsl(${hue}, 85%, 50%)`; // Using 85% saturation for slightly softer colors
}

function initMap(festivals) {
    // Sort festivals by start date first
    const sortedFestivals = [...festivals].sort((a, b) => a.start - b.start);
    
    // Create a map of festival names to their colors
    const festivalColors = {};
    sortedFestivals.forEach((festival, index) => {
        festivalColors[festival.name] = getFestivalColor(index, sortedFestivals.length);
    });

    map = L.map('map', {
        scrollWheelZoom: true,
        zoomControl: true
    }).setView([0, 0], 2);
    
    // Custom map style with teal water
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '©OpenStreetMap, ©CartoDB',
        subdomains: 'abcd',
        maxZoom: 19,
        className: 'map-tiles'
    }).addTo(map);

    // Add custom CSS filter to change water color
    const style = document.createElement('style');
    style.textContent = `
        .map-tiles {
            filter: hue-rotate(20deg) saturate(1.42);
        }
    `;
    document.head.appendChild(style);

    // Add logo as a custom control
    L.Control.Logo = L.Control.extend({
        onAdd: function(map) {
            const img = L.DomUtil.create('img', 'map-logo');
            img.src = 'img/logo.png';
            img.style.width = '150px';
            return img;
        }
    });
    
    new L.Control.Logo({ position: 'topright' }).addTo(map);
    
    festivals.forEach(festival => {
        const festivalColor = festivalColors[festival.name];
        
        // Create popup first
        const popup = L.popup({
            className: 'custom-popup',
            closeButton: true,
            autoClose: true
        }).setContent(createPopupContent(festival));

        // Create marker with color from our spectrum
        const marker = L.marker([festival.lat, festival.lon], {
            icon: L.divIcon({
                className: 'custom-marker',
                html: `<div style="background-color: ${festivalColor}"></div>`,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                popupAnchor: [1, -34]
            })
        }).bindPopup(popup);
        
        markers[festival.name] = marker;
        marker.addTo(map);
    });
}

function createPopupContent(festival) {
    return `
        <div class="festival-popup">
            <img src="img/${festival.img}" alt="${festival.name}">
            <h3>${festival.name}</h3>
            <p>${festival.desc}</p>
            <p>Dates: ${festival.start.toLocaleDateString()} - ${festival.end.toLocaleDateString()}</p>
        </div>
    `;
}

function initTimeline(festivals) {
    const container = d3.select('#gantt');
    const margin = {top: 20, right: 20, bottom: 30, left: 50};
    const minBarWidth = 30;
    
    // Sort festivals by date
    const currentDate = new Date();
    const sortedFestivals = festivals.sort((a, b) => {
        const aEnded = a.end < currentDate;
        const bEnded = b.end < currentDate;
        
        if (aEnded === bEnded) {
            return a.start - b.start;
        }
        return aEnded ? 1 : -1;
    });
    
    // Calculate date range
    const minDate = d3.min(festivals, d => d.start);
    const maxDate = d3.max(festivals, d => d.end);
    
    // Create scales
    const xScale = d3.scaleTime()
        .domain([minDate, maxDate])
        .range([margin.left, 2000]);
        
    const yScale = d3.scaleBand()
        .domain(sortedFestivals.map(d => d.name))
        .range([margin.top, 400])
        .padding(0.2);
        
    // Create SVG
    const svg = container.append('svg')
        .attr('width', 2000)
        .attr('height', 450);

    // Create tooltip div
    const tooltip = d3.select('body').append('div')
        .attr('class', 'timeline-tooltip')
        .style('opacity', 0);
        
    // Add timeline bars
    const bars = svg.selectAll('rect')
        .data(sortedFestivals)
        .enter()
        .append('rect')
        .attr('class', d => `festival-bar ${d.end < currentDate ? 'past-festival' : ''}`)
        .style('fill', (d, i) => d.end < currentDate ? '#999' : getFestivalColor(i, sortedFestivals.length))
        .attr('x', d => xScale(d.start))
        .attr('y', d => yScale(d.name))
        .attr('width', d => {
            const width = xScale(d.end) - xScale(d.start);
            return Math.max(width, minBarWidth);
        })
        .attr('height', yScale.bandwidth());

    // Add text labels
    svg.selectAll('text.festival-label')
        .data(sortedFestivals)
        .enter()
        .append('text')
        .attr('class', 'festival-label')
        .attr('x', d => {
            const width = Math.max(xScale(d.end) - xScale(d.start), minBarWidth);
            return xScale(d.start) + width + 5; // 5px padding after bar
        })
        .attr('y', d => yScale(d.name) + (yScale.bandwidth() / 2))
        .attr('dy', '0.35em') // Vertical centering
        .text(d => d.name)
        .style('fill', d => d.end < currentDate ? '#999' : '#333')
        .style('font-size', '12px');

    // Add event handlers to both bars and labels
    const addEventHandlers = (selection) => {
        selection
            .on('mouseover', (event, d) => {
                tooltip.transition()
                    .duration(200)
                    .style('opacity', .9);
                tooltip.html(`
                    <strong>${d.name}</strong><br/>
                    ${d.start.toLocaleDateString()} - ${d.end.toLocaleDateString()}
                    ${d.start.toDateString() === d.end.toDateString() ? '<br/>(One-day event)' : ''}
                `)
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 28) + 'px');
            })
            .on('mouseout', () => {
                tooltip.transition()
                    .duration(500)
                    .style('opacity', 0);
            })
            .on('click', (event, d) => {
                if (markers[d.name]) {
                    markers[d.name].openPopup();
                }
            });
    };

    addEventHandlers(bars);
    addEventHandlers(svg.selectAll('text.festival-label'));
        
    // Add only the x-axis (timeline)
    const xAxis = d3.axisBottom(xScale);
    svg.append('g')
        .attr('transform', `translate(0, ${400})`)
        .call(xAxis);

    // Add current date line
    svg.append('line')
        .attr('class', 'current-date-line')
        .attr('x1', xScale(currentDate))
        .attr('x2', xScale(currentDate))
        .attr('y1', margin.top)
        .attr('y2', 400)
        .style('stroke', 'var(--orange)')
        .style('stroke-width', 2)
        .style('stroke-dasharray', '4,4');
}

// Initialize controls
function initControls() {
    const container = document.querySelector('.timeline-container');
    
    document.getElementById('scrollLeft').addEventListener('click', () => {
        container.scrollLeft -= 200;
    });
    
    document.getElementById('scrollRight').addEventListener('click', () => {
        container.scrollLeft += 200;
    });
}

// Main initialization
async function init() {
    const festivals = await loadData();
    initMap(festivals);
    initTimeline(festivals);
    initControls();
}

init(); 