// server.js (Conceptual Node.js code - cannot be run here)

const WebSocket = require('ws'); // You'd install this via npm: npm install ws
const http = require('http'); // Node.js built-in HTTP module

const server = http.createServer((req, res) => {
    // This is a basic HTTP server. You might serve your HTML files here.
    // For simplicity, we'll assume the HTML is served by another means (e.g., a simple static file server)
    // or you can add logic to serve multiplayer_shooter.html:
    // if (req.url === '/') {
    //     res.writeHead(200, { 'Content-Type': 'text/html' });
    //     res.end('<!DOCTYPE html>... multiplayershooter.html content ...');
    // } else {
    //     res.writeHead(404);
    //     res.end('Not Found');
    // }
});

const wss = new WebSocket.Server({ server }); // Create WebSocket server attached to HTTP server

const players = {}; // Stores all connected players' states
const bullets = {}; // Stores all active bullets' states

// --- Game Settings (Server-side authoritative) ---
const GAME_TICK_RATE = 1000 / 60; // 60 updates per second
const PLAYER_SPEED = 3;
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
                    playerId = parsedMessage.player.id;
                    players[playerId] = {
                        id: playerId,
                        x: parsedMessage.player.x,
                        y: parsedMessage.player.y,
                        color: parsedMessage.player.color,
                        health: MAX_HEALTH,
                        score: 0
                    };
                    console.log(`Player ${playerId} joined.`);
                    break;

                    case 'player_input': // NEW MESSAGE TYPE FOR MOVEMENT
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const dx = parsedMessage.dx;
                        const dy = parsedMessage.dy;
                        // Apply movement on the server
                        player.x += dx;
                        player.y += dy;
                        // Clamp player position to canvas bounds (server-side validation)
                        player.x = Math.max(PLAYER_RADIUS, Math.min(800 - PLAYER_RADIUS, player.x));
                        player.y = Math.max(PLAYER_RADIUS, Math.min(600 - PLAYER_RADIUS, player.y));
                    }
                    break;

                case 'player_move':
                    if (playerId && players[playerId]) {
                        // Server-side validation and update
                        // For simplicity, directly update position, but in real game,
                        // you'd calculate new position based on speed and time
                        players[playerId].x = parsedMessage.x;
                        players[playerId].y = parsedMessage.y;
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
                            dirX: parsedMessage.bulletDirX, // Get direction from client
                            dirY: parsedMessage.bulletDirY, // Get direction from client
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

                // Remove bullet
                delete bullets[bulletId];

                // If player health drops to 0 or below
                if (player.health <= 0) {
                    console.log(`Player ${player.id} defeated!`);
                    // Reset player or remove them
                    player.health = MAX_HEALTH; // Simple respawn
                    player.x = Math.random() * 800;
                    player.y = Math.random() * 600;
                    // Optionally, remove player from 'players' object if permanent death
                }

                // Break from inner loop as bullet is gone
                break;
            }
        }
    }

    // 3. Prepare game state for clients
    const gameState = {
        type: 'game_state_update',
        players: players,
        bullets: Object.values(bullets) // Send bullets as an array
    };

    // 4. Broadcast updated game state to all connected clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });

}, GAME_TICK_RATE); // Run game logic at a fixed rate

server.listen(8080, () => {
    console.log('Game server listening on port 8080');
});
