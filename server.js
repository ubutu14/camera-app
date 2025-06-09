// server.js (The complete and correct version for your game)

const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    // A simple HTTP response for health checks or if someone tries to browse directly
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
const BULLET_LIFETIME = 60; // frames (adjust if your client's bullet lifetime is different)
const MAX_HEALTH = 100;

let nextBulletId = 0; // Simple ID counter for bullets

wss.on('connection', ws => {
    console.log('Client connected!');

    let playerId = null; // Will be set when client sends 'player_join'

    ws.on('message', message => {
        try {
            const parsedMessage = JSON.parse(message);
            // console.log('Server received:', parsedMessage); // Uncomment for server-side debugging

            switch (parsedMessage.type) {
                case 'player_join':
                    // Assign a unique ID. If client's preferred ID already exists, make it unique.
                    playerId = parsedMessage.player.id;
                    let originalPlayerId = playerId;
                    let counter = 1;
                    while (players[playerId]) { // Check if ID already exists on server
                        playerId = `${originalPlayerId}_${counter++}`;
                    }
                    
                    players[playerId] = {
                        id: playerId, // Use the potentially adjusted unique ID
                        x: parsedMessage.player.x,
                        y: parsedMessage.player.y,
                        color: parsedMessage.player.color,
                        health: MAX_HEALTH, // Always start with full health on server
                        score: 0
                    };
                    console.log(`Player ${playerId} joined.`);
                    // Send back the confirmed player ID to the client if it was adjusted
                    ws.send(JSON.stringify({ type: 'player_id_confirmed', id: playerId }));
                    
                    // Notify other players that a new player joined
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && client !== ws) {
                            client.send(JSON.stringify({ type: 'player_joined', player: players[playerId] }));
                        }
                    });
                    break;

                // --- THIS IS THE CRITICAL PART FOR MOVEMENT ---
                case 'player_input':
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const dx = parsedMessage.dx; // Direction X from client
                        const dy = parsedMessage.dy; // Direction Y from client

                        // Apply movement on the server based on game rules and PLAYER_SPEED
                        // Note: This is simplified. In a real game, you'd calculate based on time
                        // and ensure client inputs don't allow "speed hacks".
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
            }
        } catch (error) {
            console.error('Failed to parse message or handle:', error);
        }
    });

    ws.on('close', () => {
        if (playerId) {
            delete players[playerId];
            // Remove any bullets owned by this player that are still active
            for (const bulletId in bullets) {
                if (bullets[bulletId].ownerId === playerId) {
                    delete bullets[bulletId];
                }
            }
            console.log(`Player ${playerId} disconnected.`);
            // Broadcast to other clients that a player disconnected
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
            continue;
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

                // Send a specific 'player_hit' message to all clients for immediate hit markers/feedback
                // This is important for smooth hit notifications on all clients
                wss.clients.forEach(clientWs => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'player_hit',
                            id: player.id, // ID of the player who was hit
                            newHealth: player.health,
                            hitX: bullet.x,
                            hitY: bullet.y,
                            shooterId: bullet.ownerId // Optional: ID of the player who shot
                        }));
                    }
                });

                // Remove bullet
                delete bullets[bulletId];

                // If player health drops to 0 or below
                if (player.health <= 0) {
                    console.log(`Player ${player.id} defeated!`);
                    // Reset player health and respawn them
                    player.health = MAX_HEALTH;
                    player.x = Math.random() * 800; // Respawn at random location
                    player.y = Math.random() * 600;
                    // You could also broadcast a 'player_defeated' message here if you want specific handling
                }

                break; // Break from inner loop as bullet is gone
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
const PORT = process.env.PORT || 1234;
server.listen(PORT, '0.0.0.0', () => { // Listen on all available network interfaces
    console.log(`Game server listening on port ${PORT}`);
});
