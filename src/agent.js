const STATE = { 
  lastMoveDir: 0,
  frameHistory: [],
  maxHistorySize: 10
};

const CONFIG = {
  // Maximum awareness - see everything
  awarenessRadius: 1000,  // MAX - analyze entire map
  
  // Target priorities - YELLOW FIRST, BLUE ONLY WHEN STATIONARY
  yellowFlamePriority: 1000,
  blueCampfireMovingPenalty: 0,
  blueCampfireStationaryBonus: 1500,
  
  // Power-ups - AGGRESSIVE
  powerUpRadius: 1000,  // MAX - always aware of all power-ups
  powerUpChaseStrength: 8.0,
  powerUpPriorities: {
    nuke: 2000,
    rapidwalk: 1800,
    superbullet: 1600,
    rapidfire: 1400
  },
  
  // Corner avoidance - TOP PRIORITY
  cornerDangerZone: 150,
  cornerPanicDistance: 100,
  cornerEscapeForce: 10.0,
  
  // Wall avoidance
  wallDangerZone: 120,
  wallEscapeForce: 7.0,
  
  // Dynamic targeting - NO LOCK-IN
  targetSwitchThreshold: 50,  // Switch if better target found
  retargetEveryTicks: 3,      // Re-evaluate every 3 ticks
  
  // Combat
  optimalRange: 180,
  minSafeRange: 90,
  maxEngageRange: 400,
  
  // Movement
  baseRepulsion: 8000,
  repulsionPower: 2.0,
  centerAttraction: 0.4,
  
  // Shooting
  bulletSpeed: 800,
  leadFactor: 1.2,
  superBulletMinTargets: 3
};

// Math utilities
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const len = v => Math.hypot(v.x, v.y);
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y});
const add = (a, b) => ({x: a.x + b.x, y: a.y + b.y});
const mul = (v, k) => ({x: v.x * k, y: v.y * k});
const dot = (a, b) => a.x * b.x + a.y * b.y;
const dist = (a, b) => len(sub(a, b));
const norm = v => { const L = len(v); return L > 1e-6 ? {x: v.x/L, y: v.y/L} : {x:0, y:0}; };
const ang = (from, to) => { const d = sub(to, from); let a = Math.atan2(d.y, d.x) * 180/Math.PI; return a < 0 ? a + 360 : a; };
const vec = deg => { const r = deg * Math.PI/180; return {x: Math.cos(r), y: Math.sin(r)}; };

// Predict position
const predictPos = (entity, time) => {
  const vel = entity.velocity || {x:0, y:0};
  return {
    x: entity.position.x + vel.x * time,
    y: entity.position.y + vel.y * time
  };
};

// Calculate intercept time
function interceptTime(relPos, targetVel, bulletSpeed){
  const a = dot(targetVel, targetVel) - bulletSpeed * bulletSpeed;
  const b = 2 * dot(relPos, targetVel);
  const c = dot(relPos, relPos);
  
  if (Math.abs(a) < 1e-8){
    return Math.abs(b) < 1e-8 ? null : (-c/b > 0 ? -c/b : null);
  }
  
  const disc = b*b - 4*a*c;
  if (disc < 0) return null;
  
  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b - sqrtDisc) / (2*a);
  const t2 = (-b + sqrtDisc) / (2*a);
  
  const t = Math.min(t1, t2);
  return t > 0 ? t : (Math.max(t1, t2) > 0 ? Math.max(t1, t2) : null);
}

// Check if flame is stationary
function isStationary(flame, history){
  if (!history || history.length < 3) return false;
  
  for (let i = history.length - 1; i >= Math.max(0, history.length - 3); i--){
    const frame = history[i];
    const old = frame.flames?.find(f => f.id === flame.id);
    if (old && dist(old.position, flame.position) > 5) return false;
  }
  return true;
}

// ===== REAL-TIME SCENARIO ANALYZER =====
function analyzeAllScenarios(state){
  const me = state.player.position;
  const W = state.map.size.width;
  const H = state.map.size.height;
  const center = {x: W/2, y: H/2};
  
  const scenarios = {
    // Position analysis
    position: analyzePosition(me, W, H, center),
    
    // Threat analysis
    threats: analyzeThreats(me, state.flames, W, H),
    
    // Target analysis
    targets: analyzeTargets(me, state.flames, state.player, STATE.frameHistory),
    
    // Power-up analysis
    powerUps: analyzePowerUps(me, state.items, state.flames, state.player),
    
    // Movement options
    movements: analyzeMovementOptions(me, state.flames, W, H, center),
    
    // Shooting options
    shooting: analyzeShootingOptions(me, state.flames, state.player, STATE.frameHistory)
  };
  
  return scenarios;
}

// Analyze current position
function analyzePosition(me, W, H, center){
  const distToWalls = {
    left: me.x,
    right: W - me.x,
    top: me.y,
    bottom: H - me.y
  };
  
  const minWallDist = Math.min(...Object.values(distToWalls));  // to not go beyond the wallls
  const distToCenter = dist(me, center);
  
  const nearLeftEdge = me.x < CONFIG.cornerDangerZone;
  const nearRightEdge = me.x > W - CONFIG.cornerDangerZone;
  const nearTopEdge = me.y < CONFIG.cornerDangerZone;
  const nearBottomEdge = me.y > H - CONFIG.cornerDangerZone;
  
  const inCorner = (nearLeftEdge || nearRightEdge) && (nearTopEdge || nearBottomEdge);
  const nearWall = minWallDist < CONFIG.wallDangerZone;
  
  let cornerType = null;
  if (inCorner){
    if (nearLeftEdge && nearTopEdge) cornerType = 'top-left';
    else if (nearRightEdge && nearTopEdge) cornerType = 'top-right';
    else if (nearLeftEdge && nearBottomEdge) cornerType = 'bottom-left';
    else if (nearRightEdge && nearBottomEdge) cornerType = 'bottom-right';
  }
  
  return {
    distToWalls,
    minWallDist,
    distToCenter,
    inCorner,
    nearWall,
    cornerType,
    danger: inCorner ? 'CRITICAL' : nearWall ? 'HIGH' : minWallDist < 200 ? 'MEDIUM' : 'LOW'
  };
}

// Analyze all threats
function analyzeThreats(me, flames, W, H){
  const threats = flames.map(f => {
    const d = dist(me, f.position);
    const pred = predictPos(f, 1.0);
    const futureDist = dist(me, pred);
    const approaching = futureDist < d;
    
    const angleToMe = ang(f.position, me);
    const vel = f.velocity || {x:0, y:0};
    const moveAngle = Math.atan2(vel.y, vel.x) * 180/Math.PI;
    const angleMatch = Math.abs(((angleToMe - moveAngle + 180) % 360) - 180);
    const directlyTowardsMe = angleMatch < 30;
    
    let threatLevel = 0;
    if (d < 80) threatLevel = 100;
    else if (d < 120) threatLevel = 80;
    else if (d < 180) threatLevel = 60;
    else if (d < 250) threatLevel = 40;
    else if (d < 350) threatLevel = 20;
    else threatLevel = 10;
    
    if (approaching) threatLevel *= 1.5;
    if (directlyTowardsMe) threatLevel *= 1.8;
    
    return {
      flame: f,
      distance: d,
      futureDist,
      approaching,
      directlyTowardsMe,
      threatLevel,
      timeToReach: d / (len(f.velocity) || 1)
    };
  });
  
  threats.sort((a, b) => b.threatLevel - a.threatLevel);
  
  const immediate = threats.filter(t => t.distance < 100);
  const close = threats.filter(t => t.distance < 200);
  const medium = threats.filter(t => t.distance < 350);
  
  return {
    all: threats,
    immediate,
    close,
    medium,
    highestThreat: threats[0],
    averageDistance: threats.reduce((s, t) => s + t.distance, 0) / threats.length,
    totalThreatLevel: threats.reduce((s, t) => s + t.threatLevel, 0)
  };
}

// Analyze all possible targets - DYNAMIC, NO LOCK
function analyzeTargets(me, flames, player, history){
  const canFire = player.fireCooldown === 0;
  
  const targets = flames.map(f => {
    const d = dist(me, f.position);
    const isYellow = f.type === 'flame';
    const isBlue = f.type === 'campfire';
    const stationary = isStationary(f, history);
    
    let score = 0;
    
    // YELLOW FLAMES = PRIORITY (moving threats)
    if (isYellow){
      score += CONFIG.yellowFlamePriority;
      
      // Prefer close yellows (easier to hit, immediate threat)
      if (d < 150) score += 500;
      else if (d < 250) score += 300;
      
      // Low HP bonus
      if (f.hp === 1) score += 600;
      else if (f.hp === 2) score += 400;
      else if (f.hp === 3) score += 200;
    }
    
    // BLUE CAMPFIRES - ONLY when stationary
    if (isBlue){
      if (stationary){
        score += CONFIG.blueCampfireStationaryBonus;
        
        // Prioritize low HP stationary campfires (easy kill)
        if (f.hp === 1) score += 800;
        else if (f.hp === 2) score += 600;
        else if (f.hp === 3) score += 400;
      } else {
        // MOVING CAMPFIRE = DON'T SHOOT (waste of ammo)
        score += CONFIG.blueCampfireMovingPenalty;
      }
    }
    
    // Distance penalty
    score -= d * 0.5;
    
    // HP penalty
    score -= f.hp * 30;
    
    // Range preference
    if (d > CONFIG.minSafeRange && d < CONFIG.optimalRange) score += 300;
    else if (d > CONFIG.maxEngageRange) score -= 400;
    
    // Line of sight
    let blocked = false;
    for (const other of flames){
      if (other.id === f.id) continue;
      const otherD = dist(me, other.position);
      if (otherD < d * 0.5){
        const toTarget = norm(sub(f.position, me));
        const toOther = sub(other.position, me);
        const perpDist = Math.abs(toOther.x * toTarget.y - toOther.y * toTarget.x);
        if (perpDist < 30){
          blocked = true;
          break;
        }
      }
    }
    if (blocked) score -= 500;
    
    return {
      flame: f,
      distance: d,
      score,
      isYellow,
      isBlue,
      stationary,
      canShoot: canFire && d < CONFIG.maxEngageRange && !blocked
    };
  });
  
  targets.sort((a, b) => b.score - a.score);
  
  return {
    all: targets,
    best: targets[0],
    yellows: targets.filter(t => t.isYellow),
    blues: targets.filter(t => t.isBlue && t.stationary),
    shootable: targets.filter(t => t.canShoot)
  };
}

// Analyze power-up opportunities - AGGRESSIVE
function analyzePowerUps(me, items, flames, player){
  const opportunities = items.map(item => {
    const d = dist(me, item.position);
    
    // Calculate path danger
    let pathDanger = 0;
    const toItem = norm(sub(item.position, me));
    
    for (const f of flames){
      const toFlame = sub(f.position, me);
      const proj = dot(toFlame, toItem);
      
      if (proj > 0 && proj < d){
        const perpDist = Math.abs(toFlame.x * toItem.y - toFlame.y * toItem.x);
        if (perpDist < 70) pathDanger += 100 / Math.max(perpDist, 1);
      }
    }
    
    // Base worth
    let worth = CONFIG.powerUpPriorities[item.type] || 1000;
    
    // Context multipliers
    if (item.type === 'nuke' && flames.length > 15) worth *= 2.5;
    if (item.type === 'rapidwalk' && pathDanger > 50) worth *= 0.3; // Too dangerous
    else if (item.type === 'rapidwalk') worth *= 1.5;
    if (item.type === 'superbullet' && flames.length > 12) worth *= 1.8;
    if (item.type === 'rapidfire' && player.remainingTicksInRapidFire > 0) worth *= 0.3;
    
    const score = worth - d * 0.3 - pathDanger * 2;
    
    return {
      item,
      distance: d,
      pathDanger,
      worth,
      score,
      shouldChase: score > 500 && pathDanger < 150
    };
  });
  
  opportunities.sort((a, b) => b.score - a.score);
  
  return {
    all: opportunities,
    best: opportunities[0],
    chaseWorthy: opportunities.filter(o => o.shouldChase)
  };
}

// Analyze movement options
function analyzeMovementOptions(me, flames, W, H, center){
  const options = [];
  
  // Test 8 directions + stay still
  const testAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  
  for (const angle of testAngles){
    const dir = vec(angle);
    const testPos = add(me, mul(dir, 50)); // Test 50 pixels ahead
    
    // Check if in bounds
    if (testPos.x < 40 || testPos.x > W - 40 || testPos.y < 40 || testPos.y > H - 40){
      continue;
    }
    
    // Calculate safety score
    let safety = 1000;
    
    // Distance to walls
    const minWall = Math.min(testPos.x, W - testPos.x, testPos.y, H - testPos.y);
    safety += minWall * 2;
    
    // Distance to center (prefer center)
    const dCenter = dist(testPos, center);
    safety += (500 - dCenter) * 0.5;
    
    // Distance to threats
    let minThreatDist = 1000;
    for (const f of flames){
      const d = dist(testPos, f.position);
      minThreatDist = Math.min(minThreatDist, d);
      
      if (d < 100) safety -= 500;
      else if (d < 150) safety -= 200;
      else if (d < 200) safety -= 50;
    }
    
    options.push({
      angle,
      direction: dir,
      testPos,
      safety,
      minThreatDist
    });
  }
  
  // Test staying still
  let stationarySafety = 1000;
  for (const f of flames){
    const d = dist(me, f.position);
    if (d < 120) stationarySafety -= 800;
    else if (d < 180) stationarySafety -= 200;
  }
  
  options.push({
    angle: null,
    direction: {x:0, y:0},
    testPos: me,
    safety: stationarySafety,
    minThreatDist: Math.min(...flames.map(f => dist(me, f.position)))
  });
  
  options.sort((a, b) => b.safety - a.safety);
  
  return {
    all: options,
    safest: options[0],
    canStayStill: stationarySafety > 500
  };
}

// Analyze shooting options
function analyzeShootingOptions(me, flames, player, history){
  if (player.fireCooldown > 0) return { canShoot: false };
  
  const options = [];
  const superLeft = player.remainingSuperBullets || 0;
  
  // Check for super bullet opportunity
  if (superLeft > 0 && flames.length >= CONFIG.superBulletMinTargets){
    const testAngles = Array.from({length: 36}, (_, i) => i * 10);
    
    for (const angle of testAngles){
      const dir = vec(angle);
      let hits = 0;
      let value = 0;
      
      for (const f of flames){
        const toFlame = sub(f.position, me);
        const proj = dot(toFlame, dir);
        if (proj <= 0) continue;
        
        const perpDist = Math.abs(toFlame.x * dir.y - toFlame.y * dir.x);
        if (perpDist < 25){
          hits++;
          value += (f.type === 'campfire' ? 5 : 1) / f.hp;
        }
      }
      
      if (hits >= CONFIG.superBulletMinTargets){
        options.push({
          angle,
          type: 'super',
          hits,
          value
        });
      }
    }
  }
  
  // Normal shots
  for (const f of flames){
    const d = dist(me, f.position);
    if (d > CONFIG.maxEngageRange) continue;
    
    const isYellow = f.type === 'flame';
    const isBlue = f.type === 'campfire';
    const stationary = isStationary(f, history);
    
    // Skip moving campfires
    if (isBlue && !stationary) continue;
    
    const rel = sub(f.position, me);
    const vel = f.velocity || {x:0, y:0};
    const t = interceptTime(rel, vel, CONFIG.bulletSpeed);
    
    if (t && t > 0 && t < 2.0){
      const leadPos = add(f.position, mul(vel, t * CONFIG.leadFactor));
      const shotAngle = ang(me, leadPos);
      
      let value = 100;
      if (isYellow) value += 500;
      if (isBlue && stationary) value += 400;
      if (f.hp === 1) value += 300;
      value -= d * 0.5;
      
      options.push({
        angle: shotAngle,
        type: 'normal',
        target: f,
        value
      });
    }
  }
  
  options.sort((a, b) => {
    if (a.type === 'super' && b.type !== 'super') return -1;
    if (b.type === 'super' && a.type !== 'super') return 1;
    return b.value - a.value;
  });
  
  return {
    canShoot: true,
    all: options,
    best: options[0]
  };
}

// ===== MAIN DECISION FUNCTION =====
function decide(state){
  const s = state || {};
  const tick = s.tick ?? 0;
  const me = s.player?.position || {x:0, y:0};
  const W = s.map?.size?.width ?? 800;
  const H = s.map?.size?.height ?? 600;
  const center = {x: W/2, y: H/2};
  
  // Update history
  STATE.frameHistory.push({
    tick,
    flames: s.flames?.map(f => ({...f})) || []
  });
  if (STATE.frameHistory.length > STATE.maxHistorySize){
    STATE.frameHistory.shift();
  }
  
  // === ANALYZE ALL SCENARIOS ===
  const analysis = analyzeAllScenarios(s);
  
  // === DECISION MAKING ===
  let mv = {x: 0, y: 0};
  
  // PRIORITY 1: ESCAPE CORNERS (ABSOLUTE PRIORITY)
  if (analysis.position.inCorner){
    const escapeAngle = ang(me, center);
    mv = add(mv, mul(vec(escapeAngle), CONFIG.cornerEscapeForce));
  }
  
  // PRIORITY 2: ESCAPE WALLS
  if (analysis.position.nearWall && !analysis.position.inCorner){
    mv = add(mv, mul(norm(sub(center, me)), CONFIG.wallEscapeForce));
  }
  
  // PRIORITY 3: POWER-UP COLLECTION (if safe and worthy)
  if (analysis.powerUps.best && analysis.powerUps.best.shouldChase){
    const chaseForce = CONFIG.powerUpChaseStrength;
    const hasRapidWalk = s.player?.remainingTicksInRapidWalk > 0;
    mv = add(mv, mul(norm(sub(analysis.powerUps.best.item.position, me)), chaseForce * (hasRapidWalk ? 1.5 : 1.0)));
  }
  
  // PRIORITY 4: THREAT AVOIDANCE (repulsion from all threats)
  for (const threat of analysis.threats.all){
    const f = threat.flame;
    const d = Math.max(5, threat.distance);
    
    let repelStrength = 1.0;
    if (d < 80) repelStrength = 5.0;
    else if (d < 120) repelStrength = 3.5;
    else if (d < 180) repelStrength = 2.0;
    else if (d < 250) repelStrength = 1.2;
    else repelStrength = 0.6;
    
    const force = (CONFIG.baseRepulsion * repelStrength) / Math.pow(d, CONFIG.repulsionPower);
    mv = add(mv, mul(norm(sub(me, f.position)), force));
  }
  
  // PRIORITY 5: CENTER ATTRACTION
  const centerDist = dist(me, center);
  const centerPull = CONFIG.centerAttraction * (1 + centerDist / 350);
  mv = add(mv, mul(norm(sub(center, me)), centerPull));
  
  // PRIORITY 6: MAINTAIN OPTIMAL RANGE (if not critical)
  if (analysis.targets.best && !analysis.position.inCorner && !analysis.powerUps.best?.shouldChase){
    const target = analysis.targets.best.flame;
    const d = dist(me, target.position);
    
    if (d < CONFIG.minSafeRange){
      mv = add(mv, mul(norm(sub(me, target.position)), 2.0));
    } else if (d > CONFIG.maxEngageRange){
      mv = add(mv, mul(norm(sub(target.position, me)), 1.0));
    }
  }
  
  // Finalize movement
  let speed = len(mv);
  
  // Reduce movement if safe and shooting
  if (analysis.movements.canStayStill && analysis.shooting.canShoot && !analysis.position.inCorner){
    speed *= 0.4; // Minimal movement for accuracy
  }
  
  // Emergency speed boost
  if (analysis.position.inCorner || analysis.threats.immediate.length > 3){
    speed = Math.min(speed * 1.5, 1.0);
  }
  
  if (speed < 0.01){
    mv = vec(STATE.lastMoveDir || 0);
    speed = 0;
  }
  
  const dirDeg = speed > 0.1 ? ang({x:0, y:0}, mv) : STATE.lastMoveDir;
  STATE.lastMoveDir = dirDeg;
  const move = { direction: dirDeg, speed: clamp(speed, 0, 1) };
  
  // === SHOOTING ===
  let fireAngle;
  
  if (analysis.shooting.canShoot && analysis.shooting.best){
    fireAngle = analysis.shooting.best.angle;
  }
  
  return { move, fire: fireAngle };
}

module.exports = { decide };
