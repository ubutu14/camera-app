const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Multiplayer Game Server is Running!');
});

const wss = new WebSocket.Server({ server });

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

    let playerId = null; 

    ws.on('message', message => {
        try {
            const parsedMessage = JSON.parse(message);
            // console.log('Server received:', parsedMessage); // Uncomment for server-side debugging

            switch (parsedMessage.type) {
                case 'player_join':
                    playerId = parsedMessage.player.id;
                    let originalPlayerId = playerId;
                    let counter = 1;
                    while (players[playerId]) {
                        playerId = `${originalPlayerId}_${counter++}`;
                    }
                    
                    players[playerId] = {
                        id: playerId,
                        x: parsedMessage.player.x,
                        y: parsedMessage.player.y,
                        color: parsedMessage.player.color,
                        health: MAX_HEALTH,
                        score: 0,
                        inputDx: 0, // NEW: Store player's current horizontal input state
                        inputDy: 0  // NEW: Store player's current vertical input state
                    };
                    console.log(`Player ${playerId} joined. Initial position: (${players[playerId].x}, ${players[playerId].y})`);
                    
                    if (playerId !== originalPlayerId) {
                        ws.send(JSON.stringify({ type: 'player_id_confirmed', id: playerId }));
                    } else {
                        ws.send(JSON.stringify({ type: 'player_id_confirmed', id: playerId }));
                    }
                    
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN && client !== ws) {
                            client.send(JSON.stringify({ type: 'player_joined', player: players[playerId] }));
                        }
                    });
                    break;

                case 'player_input': // Client now sends input state changes
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const inputDx = parsedMessage.inputDx || 0;
                        const inputDy = parsedMessage.inputDy || 0;

                        // NEW: Update the player's stored input state
                        player.inputDx = inputDx;
                        player.inputDy = inputDy;
                        // console.log(`Player ${playerId} input updated: dx=${inputDx}, dy=${inputDy}`); // Debugging input
                    }
                    break;

                case 'player_shoot':
                    if (playerId && players[playerId]) {
                        const player = players[playerId];
                        const bulletId = `b_${nextBulletId++}`;
                        const bulletDirX = parsedMessage.bulletDirX;
                        const bulletDirY = parsedMessage.bulletDirY;

                        if (isNaN(bulletDirX) || isNaN(bulletDirY) || (bulletDirX === 0 && bulletDirY === 0)) {
                            console.warn(`Player ${playerId} sent invalid bullet direction: ${bulletDirX}, ${bulletDirY}`);
                            return;
                        }
                        
                        bullets[bulletId] = {
                            id: bulletId,
                            ownerId: playerId,
                            x: player.x,
                            y: player.y,
                            dirX: bulletDirX,
                            dirY: bulletDirY,
                            color: player.color,
                            life: BULLET_LIFETIME
                        };
                        // console.log(`Player ${playerId} shot bullet ${bulletId} from (${player.x}, ${player.y}) with dir (${bulletDirX}, ${bulletDirY})`); // Debugging shooting
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
            for (const bulletId in bullets) {
                if (bullets[bulletId].ownerId === playerId) {
                    delete bullets[bulletId];
                }
            }
            console.log(`Player ${playerId} disconnected.`);
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
    // NEW: Apply movement for all players based on their stored input state
    for (const playerId in players) {
        const player = players[playerId];
        
        let moveX = player.inputDx;
        let moveY = player.inputDy;

        const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
        if (magnitude > 0) {
            moveX = (moveX / magnitude) * PLAYER_SPEED;
            moveY = (moveY / magnitude) * PLAYER_SPEED;
        } else {
            moveX = 0;
            moveY = 0;
        }

        player.x += moveX;
        player.y += moveY;

        // Server-side bounds checking (authoritative)
        player.x = Math.max(PLAYER_RADIUS, Math.min(800 - PLAYER_RADIUS, player.x));
        player.y = Math.max(PLAYER_RADIUS, Math.min(600 - PLAYER_RADIUS, player.y));
        // if (moveX !== 0 || moveY !== 0) {
        //     console.log(`Player ${player.id} moved to (${player.x}, ${player.y}) based on input (${player.inputDx}, ${player.inputDy})`); // Debugging movement
        // }
    }

    // 1. Update bullet positions and check for expiration
    for (const bulletId in bullets) {
        const bullet = bullets[bulletId];
        bullet.x += bullet.dirX * BULLET_SPEED;
        bullet.y += bullet.dirY * BULLET_SPEED;
        bullet.life--;

        if (bullet.life <= 0 ||
            bullet.x < 0 || bullet.x > 800 ||
            bullet.y < 0 || bullet.y > 600) {
            delete bullets[bulletId];
            continue;
        }

        // 2. Collision Detection (Bullet vs. Player)
        for (const playerId in players) {
            if (bullet.ownerId === playerId) continue; 

            const player = players[playerId];
            const dx = bullet.x - player.x;
            const dy = bullet.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PLAYER_RADIUS + BULLET_RADIUS) {
                player.health -= 10;
                console.log(`Player ${player.id} hit! Health: ${player.health}`);

                if (players[bullet.ownerId]) {
                    players[bullet.ownerId].score += 10;
                }

                wss.clients.forEach(clientWs => {
                    if (clientWs.readyState === WebSocket.OPEN) {
                        clientWs.send(JSON.stringify({
                            type: 'player_hit',
                            id: player.id,
                            newHealth: player.health,
                            hitX: bullet.x,
                            hitY: bullet.y,
                            shooterId: bullet.ownerId
                        }));
                    }
                });

                delete bullets[bulletId];

                if (player.health <= 0) {
                    console.log(`Player ${player.id} defeated!`);
                    player.health = MAX_HEALTH;
                    player.x = Math.random() * 800;
                    player.y = Math.random() * 600;
                }

                break;
            }
        }
    }

    // 3. Prepare game state for clients
    const gameState = {
        type: 'game_state_update',
        players: players,
        bullets: Object.values(bullets)
    };

    // 4. Broadcast updated game state to all connected clients
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });

}, GAME_TICK_RATE);

const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Game server listening on port ${PORT}`);
});
