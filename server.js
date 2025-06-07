// server.js (Complete, Updated Node.js code - for your actual server)

const WebSocket = require('ws'); // You'd install this via npm: npm install ws
const http = require('http');

// Create a simple HTTP server (optional, but good practice for health checks or serving static files)
const server = http.createServer((req, res) => {
    // You might serve your multiplayer_shooter.html here, or have your client
    // served by a separate static hosting service (like Netlify/Vercel)
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Multiplayer Game Server is Running!');
});

const wss = new WebSocket.Server({ server });

const players = {}; // Stores all connected players' states
const bullets = {}; // Stores all active bullets' states

// --- Game Settings (Server-side authoritative) ---
const GAME_TICK_RATE = 1000 / 60; // 60 updates per second
const PLAYER_SPEED = 3; // IMPORTANT: This must be consistent with client's PLAYER_SPEED
const BULLET_SPEED = 10;
const PLAYER_RADIUS = 15;
const BULLET_RADIUS = 3;
const BULLET_LIFETIME = 60; // frames
const MAX_HEALTH = 100;

let nextBulletId = 0; // Simple ID counter for bullets

wss.on('connection', ws => {
    console.log('Client connected!');

    let playerId = null; // Will be set when client sends 'player_join'

    ws.on('message', message => {
        try {
            const parsedMessage = JSON.parse(message);

            switch (parsedMessage.type) {
                case 'player_join':
                    // Assign a unique ID if client didn't provide one, or use client's preferred ID
                    // (Server should ultimately decide the unique ID to prevent conflicts)
                    playerId = parsedMessage.player.id;
                    if (players[playerId]) { // If ID already exists, append a random string
                        playerId = `${parsedMessage.player.id}_${Math.random().toString(36).substr(2, 4)}`;
                    }

                    players[playerId] = {
                        id: playerId, // Use the potentially adjusted ID
                        x: parsedMessage.player.x,
                        y: parsedMessage.player.y,
                        color: parsedMessage.player.color,
                        health: MAX_HEALTH,
                        score: 0
                    };
                    console.log(`Player ${playerId} joined.`);
                    // Send back the confirmed player ID to the client if it was adjusted
                    ws.send(JSON.stringify({ type: 'player_id_confirmed', id: playerId }));
                    break;

                // --- NEW: Handle player input for movement ---
                case 'player_input':
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const dx = parsedMessage.dx; // Direction X from client
                        const dy = parsedMessage.dy; // Direction Y from client

                        // Apply movement on the server based on game rules
                        player.x += dx;
                        player.y += dy;

                        // Server-side bounds checking (authoritative)
                        player.x = Math.max(PLAYER_RADIUS, Math.min(800 - PLAYER_RADIUS, player.x));
                        player.y = Math.max(PLAYER_RADIUS, Math.min(600 - PLAYER_RADIUS, player.y));
                    }
                    break;

                case 'player_shoot':
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const bulletId = `b_${nextBulletId++}`;
                        bullets[bulletId] = {
                            id: bulletId,
                            ownerId: playerId,
                            x: player.x,
                            y: player.y,
                            dirX: parsedMessage.bulletDirX,
                            dirY: parsedMessage.bulletDirY,
                            color: player.color,
                            life: BULLET_LIFETIME
                        };
                    }
                    break;

                // Add more message handlers for other player actions
            }
        } catch (error) {
            console.error('Failed to parse message or handle:', error);
        }
    });

    ws.on('close', () => {
        if (playerId) {
            delete players[playerId];
            // Also remove any bullets owned by this player that are still active
            for (const bulletId in bullets) {
                if (bullets[bulletId].ownerId === playerId) {
                    delete bullets[bulletId];
                }
            }
            console.log(`Player ${playerId} disconnected.`);
            // Optionally, broadcast to other clients that a player disconnected
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client !== ws) {
                    client.send(JSON.stringify({ type: 'player_disconnected', id: playerId }));
                }
            });
        }
    });

    ws.on('error', error => {
        console.error('WebSocket error:', error);
    });
});

// --- Server Game Loop ---
setInterval(() => {
    // 1. Update bullet positions and check for expiration
    for (const bulletId in bullets) {
        const bullet = bullets[bulletId];
        bullet.x += bullet.dirX * BULLET_SPEED;
        bullet.y += bullet.dirY * BULLET_SPEED;
        bullet.life--;

        // Remove if out of bounds or expired
        if (bullet.life <= 0 ||
            bullet.x < 0 || bullet.x > 800 || // Assuming 800x600 canvas
            bullet.y < 0 || bullet.y > 600) {
            delete bullets[bulletId];
            continue; // Move to next bullet
        }

        // 2. Collision Detection (Bullet vs. Player)
        for (const playerId in players) {
            if (bullet.ownerId === playerId) continue; // Don't hit self

            const player = players[playerId];
            const dx = bullet.x - player.x;
            const dy = bullet.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PLAYER_RADIUS + BULLET_RADIUS) {
                // Collision detected!
                player.health -= 10; // Reduce health
                console.log(`Player ${player.id} hit! Health: ${player.health}`);

                // Award score to the shooter
                if (players[bullet.ownerId]) {
                    players[bullet.ownerId].score += 10;
                }

                // Send a specific 'player_hit' message to the hit player (and maybe shooter)
                // This is good for immediate feedback and hit markers
                wss.clients.forEach(clientWs => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        // Send to the hit player
                        if (clientWs._socket.remoteAddress === players[player.id].ipAddress) { // Placeholder for actual client-to-WS mapping
                             clientWs.send(JSON.stringify({ type: 'player_hit', id: player.id, newHealth: player.health, hitX: bullet.x, hitY: bullet.y }));
                        }
                        // Send to the shooter (optional, for confirmation/feedback)
                        if (clientWs._socket.remoteAddress === players[bullet.ownerId].ipAddress) {
                             clientWs.send(JSON.stringify({ type: 'player_hit_confirmed', targetId: player.id, score: players[bullet.ownerId].score }));
                        }
                    }
                });

                // Remove bullet
                delete bullets[bulletId];

                // If player health drops to 0 or below
                if (player.health <= 0) {
                    console.log(`Player ${player.id} defeated!`);
                    // Reset player or remove them
                    player.health = MAX_HEALTH; // Simple respawn
                    player.x = Math.random() * 800; // Respawn at random location
                    player.y = Math.random() * 600;
                    // Optionally, broadcast a 'player_defeated' message
                }

                // Break from inner loop as bullet is gone
                break;
            }
        }
    }

    // 3. Prepare game state for clients
    const gameState = {
        type: 'game_state_update',
        players: players, // Send all players' current authoritative states
        bullets: Object.values(bullets) // Send bullets as an array
    };

    // 4. Broadcast updated game state to all connected clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });

}, GAME_TICK_RATE); // Run game logic at a fixed rate

// Use the port provided by the environment, or default to 8080 for local development
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => { // Listen on all available network interfaces
    console.log(`Game server listening on port ${PORT}`);
});
