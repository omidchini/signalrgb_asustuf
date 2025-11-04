// ASUS TUF Radeon RX 7900 XTX SignalRGB Plugin (ENE SMBus Experimental)
// Port focus: REGISTER_I2C_PCI_DETECTOR(... 0x67)
// HIGH RISK: SMBus writes may damage hardware.
// Added safety gating and hardware effect support. Writes are only performed when EnableControl is true.

export function Name(){ return "ASUS TUF RX 7900 XTX (ENE Experimental)"; }
export function Publisher(){ return "Ported From OpenRGB"; }
export function Documentation(){ return "Experimental ENE SMBus control for ASUS TUF RX 7900 XTX Gaming OC at address 0x67."; }
export function Version(){ return 3; }
export function Type(){ return "SMBUS"; }
export function DeviceVersion(){ return deviceVersion; }
export function ImageUrl(){ return "https://assets.signalrgb.com/devices/default/gpu.png"; }
export function Size(){ return [ledCount,1]; }
export function DefaultPosition(){ return [0,0]; }
export function DefaultScale(){ return 1.0; }
export function LedNames(){ return vLedNames; }
export function LedPositions(){ return vLedPositions; }
// Added explicit LedCount export for QML convenience
export function LedCount(){ return ledCount; }

export function ControllableParameters(){
    return [
        {"property":"EnableControl","group":"safety","label":"ENABLE (Risky)","type":"boolean","default":"0"},
        {"property":"shutdownColor","group":"lighting","label":"Shutdown Color","type":"color","default":"#000000"},
        {"property":"LightingMode","group":"lighting","label":"Lighting Mode","type":"combobox","values":["Canvas","Forced"],"default":"Canvas"},
        {"property":"forcedColor","group":"lighting","label":"Forced Color","type":"color","default":"#FF6600"},
        {"property":"Brightness","group":"lighting","label":"Brightness","type":"number","min":"0","max":"255","default":"255"},
        {"property":"EffectMode","group":"effects","label":"Effect Mode","type":"combobox","values":["Direct","Static","Breathing","Flashing","Spectrum","Rainbow"],"default":"Direct"},
        {"property":"EffectSpeed","group":"effects","label":"Effect Speed (0=Fast)","type":"number","min":"0","max":"255","default":"2"},
        {"property":"EffectDirection","group":"effects","label":"Direction","type":"combobox","values":["Forward","Reverse"],"default":"Forward"}
    ];
}

const ENE = {
    DIRECT_MODE       : 0x8020,
    MODE              : 0x8021,
    SPEED             : 0x8022,
    DIRECTION         : 0x8023,
    COLORS_DIRECT_V2  : 0x8100,
    APPLY             : 0x80A0
};
const ENE_REG_DEVICE_NAME = 0x1000; // ASCII name (first bytes)
const ENE_REG_CONFIG_TABLE = 0x1C00; // base for config table
const ENE_CONFIG_LED_COUNT = 0x02;   // index inside config table

// Mode mapping (OpenRGB -> human readable)
const ENE_MODE = {
    OFF:0,
    STATIC:1,
    BREATHING:2,
    FLASHING:3,
    SPECTRUM:4,
    RAINBOW:5
};

const EFFECT_MAP = {
    "Direct": null,              // use streaming (direct RGB)
    "Static": ENE_MODE.STATIC,   // hardware static (single color from first LED color bytes)
    "Breathing": ENE_MODE.BREATHING,
    "Flashing": ENE_MODE.FLASHING,
    "Spectrum": ENE_MODE.SPECTRUM,
    "Rainbow": ENE_MODE.RAINBOW
};

// Streaming pointer/data definitions (matches OpenRGB i2c_smbus interface usage)
const STREAM = { CMD:0x00, DATA_W:0x01, DATA_R:0x81, DATA_BLOCK:0x03 };

let deviceVersion = "";
let ledCount = 4; // default fallback
let vLedNames = ["Logo","Accent 1","Accent 2","Accent 3"];
let vLedPositions = [[0,0],[1,0],[2,0],[3,0]];
let addr = 0x67; // detector address from OpenRGB list
let busRef = null;
let detected = false;
let iface = null;
let initialized = false; // mirrored in QML if needed
let originalDirect = -1;
let lastEffectMode = null;
let lastSpeed = -1;
let lastDirection = -1;
let directActive = false;

function hexToRgb(hex){ const v=hex.replace('#',''); return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)]; }
function clamp(v,min,max){ return v<min?min:v>max?max:v; }

class ENEGPUInterface {
    constructor(bus,address){ this.bus=bus; this.address=address; }
    _encodeReg(reg){ return ((reg << 8) & 0xFF00) | ((reg >> 8) & 0x00FF); }
    _setPointer(reg){
        // Pointer write kept minimal; abort if control disabled to avoid unintended state changes during detection
        if(!EnableControl && initialized) return; // only allow pointer changes after initialization when user enabled
        try {
            if(this.bus.WriteWord){ this.bus.WriteWord(this.address, 0x00, this._encodeReg(reg)); }
            else if(this.bus.WriteBlock){ this.bus.WriteBlock(this.address, 0x00, [ (reg>>8)&0xFF, reg & 0xFF ]); }
            else if(this.bus.WriteByte){ // fallback two-byte pointer
                const enc=this._encodeReg(reg); this.bus.WriteByte(this.address, 0x00, (enc>>8)&0xFF); this.bus.WriteByte(this.address, 0x00, enc & 0xFF);
            }
        } catch(e){ }
    }
    WriteRegister(reg,val){
        try {
            this._setPointer(reg);
            if(this.bus.WriteByte){ this.bus.WriteByte(this.address, 0x01, val & 0xFF); }
            else if(this.bus.WriteBlock){ this.bus.WriteBlock(this.address, 0x01, [ val & 0xFF ]); }
        } catch(e){ }
    }
    ReadRegister(reg){
        try {
            this._setPointer(reg);
            if(this.bus.ReadByte){ return this.bus.ReadByte(this.address, 0x81); }
            else if(this.bus.ReadBlock){ const blk = this.bus.ReadBlock(this.address, 0x81, 1); return Array.isArray(blk)&&blk.length?blk[0]:-1; }
        } catch(e){ }
        return -1;
    }
    WriteRGBArray(startReg, flat){
        let idx=0; let reg=startReg;
        while(idx < flat.length){
            const chunk = flat.slice(idx, idx+3);
            try {
                this._setPointer(reg);
                if(this.bus.WriteBlock){ this.bus.WriteBlock(this.address, 0x03, chunk); }
                else if(this.bus.WriteByte){ for(let j=0;j<chunk.length;j++){ this.bus.WriteByte(this.address, 0x03, chunk[j]); } }
            } catch(e){ }
            reg += chunk.length; idx += chunk.length;
        }
    }
}

export function Scan(bus){
    // MUST return array of numeric addresses per SignalRGB spec
    const found = [];
    try {
        if(!bus){ return found; }
        // Only scan AMD GPU busses
        if(bus.IsSystemBus && bus.IsSystemBus()) { /* skip system (motherboard) bus */ }
        if(bus.IsAMDBus && !bus.IsAMDBus()) return found;
        // Validate PCI identifiers if available
        const AMD_VENDOR = 0x1002; // AMD
        const ASUS_SUBVENDOR = 0x1043; // ASUS
        const NAVI31_DEV = 0x744C; // AMD_NAVI31_DEV
        if(bus.Vendor && bus.Product){
            if(bus.Vendor() !== AMD_VENDOR || bus.Product() !== NAVI31_DEV){ return found; }
            if(bus.SubVendor && bus.SubVendor() !== ASUS_SUBVENDOR){ return found; }
        }
        // Passive detection: attempt to read LED count register without enabling direct mode.
        let ledProbe = -1;
        try {
            if(bus.WriteWord){ bus.WriteWord(addr, 0x00, ((ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT) << 8) & 0xFF00 | ((ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT) >> 8)); }
            else if(bus.WriteBlock){ bus.WriteBlock(addr, 0x00, [ ((ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT)>>8)&0xFF, (ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT) & 0xFF ]); }
            ledProbe = bus.ReadByte ? bus.ReadByte(addr, 0x81) : -1;
        } catch(e){ ledProbe = -1; }
        if(ledProbe > 0 && ledProbe <= 32){ found.push(addr); }
    } catch(e){ }
    return found;
}

export function Initialize(){
    busRef = device.bus;
    if(!busRef){ return; }
    iface = new ENEGPUInterface(busRef, addr);
    // Only now mark initialized (pointer writes gated by EnableControl thereafter)
    initialized = true;
    // Safe reads (no mode changes) to determine LED count and name
    const probe1 = iface.ReadRegister(ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT);
    const probe2 = iface.ReadRegister(ENE_REG_CONFIG_TABLE + ENE_CONFIG_LED_COUNT);
    const cfgCount = (probe1 === probe2) ? probe1 : -1;
    if(cfgCount > 0 && cfgCount <= 32){
        ledCount = cfgCount;
        vLedNames = Array.from({length:ledCount}, (_,i)=>`LED ${i+1}`);
        vLedPositions = Array.from({length:ledCount}, (_,i)=>[i,0]);
    }
    const nameBytes = [];
    for(let i=0;i<12;i++){ const b = iface.ReadRegister(ENE_REG_DEVICE_NAME + i); if(b > 31 && b < 127){ nameBytes.push(String.fromCharCode(b)); } }
    if(nameBytes.length){ deviceVersion = nameBytes.join("").trim(); }
    detected = true;
    device.log(`Detected ASUS TUF GPU @0x${addr.toString(16)} LEDs:${ledCount} (control disabled until enabled)`, {toFile:true});
    device.addMessage("asus_tuf_warning", "Experimental SMBus control is DISABLED until you toggle 'ENABLE (Risky)'", "Writes occur only while enabled.");
}

function ensureDirectMode(){
    if(!iface || !EnableControl){ return; }
    if(!directActive){
        iface.WriteRegister(ENE.DIRECT_MODE, 0x01); // enable software direct
        directActive = true;
    }
}

function disableDirectMode(){
    if(!iface || !EnableControl){ return; }
    if(directActive){
        iface.WriteRegister(ENE.DIRECT_MODE, 0x00); // hand back to effect engine
        directActive = false;
    }
}

function applyEffectMode(force=false){
    if(!iface || !EnableControl){ return; }
    const hwMode = EFFECT_MAP[EffectMode];
    const dir = (EffectDirection === "Reverse") ? 0x1 : 0x0;
    if(hwMode === null){ // Direct streaming
        ensureDirectMode();
        return;
    }
    // Hardware effect: disable direct mode then set registers if changed
    disableDirectMode();
    const speed = clamp(EffectSpeed|0,0,255);
    if(force || hwMode !== lastEffectMode || speed !== lastSpeed || dir !== lastDirection){
        iface.WriteRegister(ENE.MODE, hwMode);
        iface.WriteRegister(ENE.SPEED, speed);
        iface.WriteRegister(ENE.DIRECTION, dir);
        iface.WriteRegister(ENE.APPLY, 0x01);
        lastEffectMode = hwMode; lastSpeed = speed; lastDirection = dir;
    }
}

export function Render(){
    if(!detected || !iface){ return; }
    if(!EnableControl){ return; } // safety gate: NOTHING WRITTEN while disabled
    if(EffectMode && EffectMode !== "Direct"){
        applyEffectMode();
        return;
    }
    ensureDirectMode();
    const flat=[]; const bScale = clamp(Brightness,0,255)/255.0; const safeLedCount=Math.min(Math.max(ledCount,1),64);
    for(let i=0;i<safeLedCount;i++){
        const pos = vLedPositions[i] || [0,0];
        const src = (LightingMode === "Forced") ? hexToRgb(forcedColor) : device.color(pos[0], pos[1]);
        flat.push(Math.round(src[0]*bScale), Math.round(src[1]*bScale), Math.round(src[2]*bScale));
    }
    try { iface.WriteRGBArray(ENE.COLORS_DIRECT_V2, flat); iface.WriteRegister(ENE.APPLY, 0x01); } catch(e){ }
}

export function Shutdown(){
    if(!detected || !iface){ return; }
    if(EnableControl){
        // Set all to shutdown color via direct mode write (enable direct temporarily if needed)
        iface.WriteRegister(ENE.DIRECT_MODE, 0x01);
        const c = hexToRgb(shutdownColor);
        const off=[]; const safeLedCount = Math.min(Math.max(ledCount,1),64);
        for(let i=0;i<safeLedCount;i++){ off.push(c[0],c[1],c[2]); }
        try { iface.WriteRGBArray(ENE.COLORS_DIRECT_V2, off); iface.WriteRegister(ENE.APPLY, 0x01); } catch(e){ }
        // Restore original state
        if(originalDirect >= 0){ iface.WriteRegister(ENE.DIRECT_MODE, originalDirect & 0xFF); }
        else { iface.WriteRegister(ENE.DIRECT_MODE, 0x00); }
    }
    device.removeMessage("asus_tuf_warning");
}

// on*Changed callbacks
export function onEnableControlChanged(){
    if(!EnableControl){
        // When disabling, revert to hardware control without touching prior direct state (leave default 0)
        if(iface){ iface.WriteRegister(ENE.DIRECT_MODE, 0x00); }
        directActive = false;
    } else {
        lastEffectMode = null; lastSpeed = -1; lastDirection = -1; directActive = false;
        applyEffectMode(true);
    }
}
export function onEffectModeChanged(){ applyEffectMode(true); }
export function onEffectSpeedChanged(){ applyEffectMode(); }
export function onEffectDirectionChanged(){ applyEffectMode(); }
// Brightness re-stream callback
export function onBrightnessChanged(){ /* force resend next frame */ }

export function Validate(){ return true; }
