import React, { useState } from 'react';
import { 
  AppBar, Toolbar, Typography, Button, Container, 
  Grid, Card, CardContent, CardActions, Chip,
  IconButton, Box, Paper, Drawer, List, ListItem, ListItemButton, 
  ListItemText, ListItemIcon, Divider
} from '@mui/material';
import UsbIcon from '@mui/icons-material/Usb';
import AndroidIcon from '@mui/icons-material/Android';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';

import { AdbDaemonWebUsb } from "@yume-chan/adb-daemon-webusb";
import { Adb } from "@yume-chan/adb";
import ScrcpyView from './components/ScrcpyView';

function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  
  const handleConnect = async () => {
    setError(null);
    try {
      const manager = AdbDaemonWebUsb.Manager;
      const usbDevice = await manager.requestDevice();
      if (!usbDevice) return; 
      
      setConnecting(true);
      
      const connection = await usbDevice.connect();
      
      const adb = await Adb.open({
        connection,
        credentialStore: undefined, 
      });
      
      const newDevice = {
          id: usbDevice.serial,
          adb,
          model: usbDevice.raw.productName || "Android Device",
          serial: usbDevice.serial,
          usbDevice: usbDevice
      };

      setDevices(prev => [...prev, newDevice]);
      setSelectedDeviceId(newDevice.id);
      setConnecting(false);

    } catch (e) {
      console.error(e);
      setError(e.message);
      setConnecting(false);
    }
  };

  const handleDisconnect = async (deviceId) => {
      const dev = devices.find(d => d.id === deviceId);
      if (dev && dev.adb) {
          try {
              await dev.adb.close();
          } catch(e) {/* ignore */}
      }
      setDevices(prev => prev.filter(d => d.id !== deviceId));
      if (selectedDeviceId === deviceId) {
          setSelectedDeviceId(null);
      }
  };

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      {/* Sidebar / Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          width: 280,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: 280, boxSizing: 'border-box', bgcolor: 'background.paper', borderRight: '1px solid rgba(255,255,255,0.08)' },
        }}
      >
        <Toolbar>
            <Typography variant="h6" noWrap component="div" sx={{ color: 'primary.main', display: 'flex', alignItems: 'center' }}>
                <AndroidIcon sx={{ mr: 1 }} />
                Scrcpy Web M3
            </Typography>
        </Toolbar>
        <Divider />
        <Container sx={{ py: 2 }}>
            <Button 
                fullWidth 
                variant="contained" 
                startIcon={<AddIcon />}
                onClick={handleConnect}
                disabled={connecting}
            >
                {connecting ? 'Pairing...' : 'Pair New Device'}
            </Button>
        </Container>
        <Divider sx={{ mb: 1 }} />
        <List>
            {devices.length === 0 && (
                <ListItem>
                    <ListItemText secondary="No devices connected" sx={{ textAlign: 'center', opacity: 0.6 }} />
                </ListItem>
            )}
            {devices.map((dev) => (
                <ListItem key={dev.id} disablePadding secondaryAction={
                    <IconButton edge="end" aria-label="disconnect" onClick={(e) => { e.stopPropagation(); handleDisconnect(dev.id); }}>
                      <StopIcon fontSize="small" />
                    </IconButton>
                }>
                    <ListItemButton 
                        selected={selectedDeviceId === dev.id}
                        onClick={() => setSelectedDeviceId(dev.id)}
                    >
                        <ListItemIcon>
                            <UsbIcon color={selectedDeviceId === dev.id ? 'primary' : 'inherit'} />
                        </ListItemIcon>
                        <ListItemText 
                            primary={dev.model} 
                            secondary={dev.serial} 
                            primaryTypographyProps={{ fontWeight: selectedDeviceId === dev.id ? 'bold' : 'regular' }}
                        />
                    </ListItemButton>
                </ListItem>
            ))}
        </List>
      </Drawer>

      {/* Main Content */}
      <Box component="main" sx={{ flexGrow: 1, p: 3, display: 'flex', flexDirection: 'column' }}>
        <Toolbar /> {/* Spacer */}
        
        {error && (
            <Paper sx={{ p: 2, mb: 2, bgcolor: '#fdecea', color: '#b71c1c' }}>
                <Typography>{error}</Typography>
            </Paper>
        )}

        {selectedDevice ? (
             <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                 <Box sx={{ mb: 2, display: 'flex', alignItems: 'center' }}>
                    <Typography variant="h5" sx={{ flexGrow: 1 }}>{selectedDevice.model}</Typography>
                    <Chip label="USB" color="success" size="small" variant="outlined" />
                 </Box>
                 <ScrcpyView device={selectedDevice} />
             </Box>
        ) : (
             <Box sx={{ 
                flexGrow: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center',
                opacity: 0.5,
                border: '2px dashed rgba(255,255,255,0.1)',
                borderRadius: 4
            }}>
                <AndroidIcon sx={{ fontSize: 60, mb: 2, opacity: 0.5 }} />
                {devices.length > 0 ? (
                    <Typography variant="h5">Select a device from the sidebar</Typography>
                ) : (
                    <Typography variant="h5">Pair a device to start</Typography>
                )}
            </Box>
        )}
      </Box>
    </Box>
  );
}

export default App;
