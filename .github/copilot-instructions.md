# Augmented Wiki - AI Coding Instructions

## Project Overview
AR-enabled web application where users point their smartphone camera at real-world points of interest (POIs) to view Wikipedia articles overlaid on the camera feed. Users can adjust viewing distance (1-10km) via settings menu.

## Architecture

### Core Components
- **Camera/AR Module**: WebRTC/getUserMedia for camera access, device orientation API for tracking
- **Geolocation Service**: GPS positioning + compass heading to determine what user is looking at
- **POI Detection**: Calculate POIs in user's view frustum based on GPS, heading, and device tilt
- **Wikipedia Integration**: Fetch articles via Wikipedia API for detected POIs
- **AR Overlay Renderer**: Position Wikipedia content on camera feed using direct CSS positioning (left/top properties)

### Data Flow
1. Get user location (GPS) + device orientation (compass, gyroscope)
2. Query POI database (OpenStreetMap/Wikidata) for nearby **tourism attractions, museums, and historic sites only**
3. Calculate which POIs are in camera viewfinder (horizontal FOV filtering only)
4. Fetch Wikipedia summaries for visible POIs (cached in memory)
5. Render AR overlays positioned at POI screen coordinates with collision detection

## Technology Stack Decisions

### Frontend
- **Framework**: Vanilla JS with ES6 modules - maximum compatibility across iOS/Android
- **AR Implementation**: Direct CSS positioning (left/top) with translateX(-50%) for centering - NO complex transforms
- **APIs**: 
  - Geolocation API for position
  - DeviceOrientation API for heading/tilt (iOS 13+ requires user gesture permission)
  - Wikipedia REST API (action=query&prop=extracts)
  - Overpass API (OpenStreetMap) for POI coordinates with filtered queries

### Mobile Considerations
- Progressive Web App with manifest.json for "Add to Home Screen"
- HTTPS required (camera/location permissions)
- Optimize for low bandwidth - lazy load images, compress responses
- Battery efficiency - throttle API calls (5s minimum), update interval 50ms for POI rendering
- **No offline support** - always fetch fresh data from APIs
- Test on both iOS Safari AND Android Chrome equally (no priority)
- **iOS 13+ Permission**: DeviceOrientation requires `requestPermission()` called in response to user gesture

## Development Workflows

### Local Development
```bash
# Camera/location APIs require HTTPS - two approaches:

# Option 1: Local HTTPS with mkcert (test on same WiFi network)
brew install mkcert  # macOS - or use apt/choco for Linux/Windows
mkcert -install
mkcert localhost 192.168.1.x  # your local IP
npx serve --ssl-cert ./localhost+1.pem --ssl-key ./localhost+1-key.pem

# Option 2: ngrok tunnel (easiest for phone testing)
brew install ngrok  # or download from ngrok.com
npx serve  # start local server on port 3000
ngrok http 3000  # get public HTTPS URL for phone

# Access from phone: Open ngrok URL or https://192.168.1.x:port
# Desktop browser CAN'T test sensors - MUST use actual device
```

### Testing Strategy
- Mock geolocation data for reproducible testing
- Test matrix: iOS Safari + Android Chrome (equal priority, ALL devices)
- POI calculation accuracy tests (known landmarks at known coordinates)
- Cross-browser sensor API compatibility (orientation events differ between browsers)

## Code Conventions

### POI Filtering (Overpass API)
- **ONLY fetch tourism attractions, museums, and historic sites** with Wikipedia/Wikidata tags
- **Always fetch 10km radius** regardless of slider setting to allow instant client-side filtering
- Query structure:
  ```
  ["tourism"~"^(attraction|museum)$"][~"^(wikipedia|wikidata)$"~"."](if:t["name"])
  ["historic"][~"^(wikipedia|wikidata)$"~"."](if:t["name"])
  ```
- All POIs must have name tags
- Cache results for 5 minutes to minimize API calls
- Use circular `around` query to fetch all surrounding POIs regardless of initial heading

### POI Coordinate System & Screen Projection
- Store POI locations as WGS84 lat/lng (standard GPS format)
- Use haversine formula for distance calculations
- Use `allPOIs` passed to renderer without pre-filtering by FOV to allow 360-degree exploration
- **Horizontal positioning**: Map azimuth difference (bearing - heading) to screen x-coordinate
  - Azimuth normalized to -180° to 180° range
  - Only show POIs within horizontal FOV (±30° by default, 60° total)
- **Vertical positioning**: Distance-based linear distribution (NO altitude/pitch calculations)
  - Close POIs (0m): 85% from top (lower screen)
  - Far POIs (5000m): 10% from top (upper screen)
  - Formula: `yPercent = 0.85 - (distance/5000) * 0.75`
- **DO NOT use vertical FOV filtering** - causes POIs to disappear when tilting device

### Label Positioning & Rendering
- **Use direct CSS properties**: `left` and `top` for positioning
- **Center horizontally**: Apply `transform: translateX(-50%)` ONLY
- **AVOID**: Complex transforms like `translate(-50%, -50%)` or `translate3d()` - they cause positioning bugs
- **Z-index layering**: POI labels = 5, Settings screen = 100
- **No transitions on position** - causes laggy movement (opacity transitions OK)
- Update interval: 50ms for responsive tracking

### Collision Detection
- Bidirectional adjustment: alternate pushing labels up and down
- Minimum spacing: 15px between labels
- Label dimensions: 220px width × 100px height (estimated)
- Keep labels within screen bounds with 50px margin
- Maximum 15 collision resolution attempts per label

### API Rate Limiting
- Wikipedia: Cache responses in memory (session-based, no persistence)
- Overpass API: Minimum 1 second between requests, exponential backoff on errors
- POI fetch throttling: 5 second minimum interval, only refetch on distance slider change
- Prevent concurrent POI fetches with pending request tracking

### AR Positioning Best Practices
- Account for device orientation offset (magnetic declination)
- Filter sensor noise with smoothing algorithms (exponential moving average for compass)
- Render POI labels only within horizontal FOV (no vertical checks)
- Recalculate screen positions every frame (50ms) to track device rotation

## Key Files Structure

```
/src
  /core
    geolocator.js      # GPS + compass handling with smoothing
    poi-detector.js    # Overpass API queries, frustum filtering
    wiki-client.js     # Wikipedia REST API client with caching
  /ar
    camera-stream.js   # getUserMedia camera feed
    overlay-renderer.js # Direct CSS positioning, collision detection
  /utils
    coordinates.js     # Haversine, bearing, screen projection
    sensors.js         # Orientation smoothing (exponential moving average)
  main.js             # App orchestration, permission flows
/public
  index.html          # PWA structure, permission screens
  styles.css          # AR overlays, settings UI
  manifest.json       # PWA configuration
```

## Critical Implementation Notes

### Known Issues & Solutions
1. **POIs clustering in upper half of screen**
   - **Cause**: CSS `transform: translate(-50%, -50%)` shifts labels up by 50% of height
   - **Fix**: Only use `translateX(-50%)` for horizontal centering

2. **POIs not moving when device rotates**
   - **Cause**: CSS transitions on position properties (left/top) delay updates
   - **Fix**: Remove transitions, or only apply to opacity

3. **POIs overlaying settings menu**
   - **Cause**: High z-index values on labels
   - **Fix**: Labels z-index=5, Settings screen z-index=100

4. **Infinite loading loop**
   - **Cause**: GPS position updates triggering POI refetch every few seconds
   - **Fix**: Only fetch POIs once on initial position, then on manual distance change

5. **POIs disappear when tilting device**
   - **Cause**: Vertical FOV filtering removes POIs outside tilt range
   - **Fix**: Remove vertical FOV checks, only filter by horizontal FOV

6. **iOS Safari Location Permissions**
   - **Cause**: `watchPosition` may fail if chained after other async permission requests (like camera) due to loss of "user gesture" context.
   - **Fix**: Use `Promise.all` to request Camera and Location permissions in parallel, ensuring both attach to the initial button click event. Use `getCurrentPosition` first to force the prompt.

### Performance Optimizations
- Throttle POI fetches: 5s minimum interval + concurrent request prevention
- Update POI positions: 50ms interval (20fps for AR tracking)
- Collision detection: Limit to 15 attempts, prefer bidirectional adjustment
- Distance-based LOD: Closer POIs have render priority

### Compass Calibration
- Prompt user to calibrate compass on first load (figure-8 motion)
- Smoothing: Exponential moving average (alpha=0.1) for compass readings
- Handle wraparound at 0°/360° boundary correctly

### Permission Flow
- Request camera → location → device sensors in sequence with clear UX
- iOS 13+: Call `DeviceOrientationEvent.requestPermission()` in calibration button handler
- Fallback Mode: If AR fails, show map view with nearby POIs as list

### Privacy
- Don't store user location - process client-side only
- Wikipedia API calls are public (consider privacy implications)

## External Dependencies

- **POI Data Sources**: 
  - Wikidata SPARQL endpoint: https://query.wikidata.org/
  - Wikipedia API: https://www.mediawiki.org/wiki/API:Main_page
  - OpenStreetMap Nominatim for geocoding

- **Browser APIs**: Verify availability before use (feature detection)
  - navigator.geolocation (required)
  - DeviceOrientationEvent (required for AR)
  - MediaDevices.getUserMedia (required for camera)

## Performance Targets
- Initial load: < 3s on 4G
- POI detection: < 100ms after orientation change
- Wikipedia fetch: < 500ms (with caching)
- AR tracking: 50ms update interval (20fps minimum for responsive movement)
- Collision detection: < 20ms per frame for 20+ POIs

## Testing Checklist
- [ ] POIs appear/disappear correctly when rotating device (horizontal FOV filtering)
- [ ] POIs distributed vertically based on distance (close=bottom, far=top)
- [ ] No overlapping labels (collision detection working)
- [ ] Labels stay behind settings menu (z-index correct)
- [ ] No infinite loading (POI fetch throttled)
- [ ] Smooth movement as device rotates (no laggy transitions)
- [ ] iOS 13+ device orientation permission granted
- [ ] Compass heading updates in real-time (check console logs)
- [ ] Wikipedia links open correctly in new tab
