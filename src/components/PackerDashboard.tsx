'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Search, 
  Camera as CameraIcon, 
  Check, 
  X, 
  History as HistoryIcon, 
  Package, 
  Loader2 
} from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

interface PackerDashboardProps {
    packerId: string;
}

type CameraMode = 'off' | 'scanning' | 'photo';

export default function PackerDashboard({ packerId }: PackerDashboardProps) {
    const [trackingNumber, setTrackingNumber] = useState('');
    const [cameraMode, setCameraMode] = useState<CameraMode>('off');
    const [scannedTracking, setScannedTracking] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [showDetails, setShowDetails] = useState(false);
    const [history, setHistory] = useState<any[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [todayCount, setTodayCount] = useState(0);
    const [goal, setGoal] = useState(50);
    
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Mock details
    const mockDetails = {
        productTitle: 'Sony Alpha a7 IV Mirrorless Camera',
        boxSize: '12x12x12',
        instructions: 'Fragile. Wrap in double bubble wrap. Use heavy duty tape.',
        shippingMethod: 'UPS Ground',
        customer: 'John Doe',
        destination: '123 Main St, Brooklyn, NY 11201'
    };

    useEffect(() => {
        fetchHistory();
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(console.error);
            }
        };
    }, []);

    const fetchHistory = async () => {
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/packing-logs?packerId=${packerId}`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setHistory(data);
                // Count today's orders
                const today = new Date().toISOString().split('T')[0];
                const count = data.filter((log: any) => 
                    new Date(log.packedAt).toISOString().split('T')[0] === today
                ).length;
                setTodayCount(count);
            }
        } catch (err) {
            console.error("Failed to fetch history:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    const startScanning = async () => {
        setCameraMode('scanning');
        setShowDetails(false);
        setPhotos([]);
        setScannedTracking('');
        
        setTimeout(async () => {
            try {
                const html5QrCode = new Html5Qrcode("reader");
                scannerRef.current = html5QrCode;
                await html5QrCode.start(
                    { facingMode: "environment" },
                    { fps: 10, qrbox: { width: 250, height: 150 } },
                    (decodedText) => {
                        setScannedTracking(decodedText);
                        setTrackingNumber(decodedText);
                        stopScanning();
                        setCameraMode('photo');
                        startCameraForPhoto();
                    },
                    (errorMessage) => {
                        // ignore
                    }
                );
            } catch (err) {
                console.error("Failed to start scanner:", err);
                setCameraMode('off');
            }
        }, 100);
    };

    const stopScanning = async () => {
        if (scannerRef.current) {
            try {
                await scannerRef.current.stop();
                scannerRef.current = null;
            } catch (err) {
                console.error("Failed to stop scanner:", err);
            }
        }
    };

    const startCameraForPhoto = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'environment' } 
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            console.error("Failed to start photo camera:", err);
        }
    };

    const takePhoto = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0);
            const photoData = canvas.toDataURL('image/jpeg');
            setPhotos(prev => [...prev, photoData]);
        }
    };

    const finishPacking = async () => {
        // Stop camera stream
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }

        const currentTracking = scannedTracking || trackingNumber;
        
        if (currentTracking) {
            try {
                await fetch('/api/packing-logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trackingNumber: currentTracking,
                        photos: photos,
                        packerId: packerId,
                        boxSize: mockDetails.boxSize,
                    })
                });
                fetchHistory(); // Refresh history and count
            } catch (err) {
                console.error("Failed to save packing log:", err);
            }
        }

        setCameraMode('off');
        setShowDetails(true);
    };

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (trackingNumber) {
            setScannedTracking(trackingNumber);
            setShowDetails(true);
        }
    };

    return (
        <div className="flex h-screen bg-gray-950 text-white overflow-hidden font-sans">
            {/* Sidebar - Hidden on mobile, visible on tablet/desktop */}
            <div className="hidden lg:flex w-80 flex-shrink-0 border-r border-white/10 flex-col bg-gray-900/50 backdrop-blur-xl">
                {/* Top Entry Form */}
                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-xl bg-blue-500/20 flex items-center justify-center">
                            <Package className="w-4 h-4 text-blue-400" />
                        </div>
                        <h2 className="text-sm font-black uppercase tracking-widest text-gray-400">Manual Entry</h2>
                    </div>
                    <form onSubmit={handleManualSubmit} className="relative group">
                        <input
                            type="text"
                            value={trackingNumber}
                            onChange={(e) => setTrackingNumber(e.target.value)}
                            placeholder="Tracking #"
                            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-5 text-sm font-mono focus:ring-2 focus:ring-blue-500/50 outline-none transition-all group-hover:border-white/20"
                        />
                        <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-white transition-colors">
                            <Search className="w-5 h-5" />
                        </button>
                    </form>
                </div>

                <div className="flex-1" />

                {/* Bottom of Side Panel */}
                <div className="p-6 border-t border-white/10 bg-gray-900/80 space-y-6">
                    <div className="bg-white/5 rounded-2xl p-4 border border-white/10 text-center">
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Recommended Box</p>
                        <p className="text-xl font-black text-blue-400">{mockDetails.boxSize}</p>
                    </div>

                    <div className="relative">
                        <div className="flex gap-3">
                            <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl py-4 px-5 text-sm font-mono text-gray-400">
                                {trackingNumber || 'Scan Barcode...'}
                            </div>
                            <button 
                                onClick={startScanning}
                                className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/20"
                            >
                                <CameraIcon className="w-6 h-6 text-white" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-gray-950">
                {/* Header with History Button (Mobile Friendly) */}
                <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20 pointer-events-none">
                    <div className="pointer-events-auto">
                        {/* Logo or placeholder */}
                        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <Package className="w-5 h-5 text-white" />
                        </div>
                    </div>
                    <button 
                        onClick={() => setShowHistory(true)}
                        className="p-3 bg-white/5 backdrop-blur-md hover:bg-white/10 rounded-xl border border-white/10 transition-all active:scale-95 group pointer-events-auto"
                    >
                        <HistoryIcon className="w-5 h-5 text-gray-400 group-hover:text-white" />
                    </button>
                </div>

                <div className="flex-1 flex flex-col pt-24 px-6 pb-28 overflow-y-auto scrollbar-hide">
                    <AnimatePresence mode="wait">
                        {(scannedTracking || showDetails) && cameraMode === 'off' ? (
                            <motion.div 
                                key="order-active"
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="space-y-8"
                            >
                                {/* 1. Product Title on Top */}
                                <div className="text-center space-y-2">
                                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Active Product</p>
                                    <h1 className="text-2xl font-black leading-tight">{mockDetails.productTitle}</h1>
                                </div>

                                {/* 2. Customer Shipping Details Below */}
                                <div className="bg-white/5 rounded-[2rem] p-6 border border-white/10 space-y-4">
                                    <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
                                            <Search className="w-4 h-4 text-gray-400" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Customer</p>
                                            <p className="text-sm font-bold text-white">{mockDetails.customer}</p>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Shipping Address</p>
                                        <p className="text-sm font-medium text-gray-300 leading-relaxed">{mockDetails.destination}</p>
                                        <p className="text-xs font-black text-blue-400 mt-2 uppercase tracking-widest">{mockDetails.shippingMethod}</p>
                                    </div>
                                </div>

                                {/* 3. How to Pack / Quick Details */}
                                <div className="bg-blue-600/10 rounded-[2rem] p-6 border border-blue-600/20 space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Check className="w-4 h-4 text-blue-400" />
                                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Packing Instructions</p>
                                    </div>
                                    <p className="text-base font-medium leading-relaxed text-blue-50/90">{mockDetails.instructions}</p>
                                </div>

                                {/* 4. Box Size Display */}
                                <div className="bg-white/[0.03] rounded-3xl p-8 border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 text-center">
                                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Best Box Size</p>
                                    <p className="text-4xl font-black text-white tracking-tighter">{mockDetails.boxSize}</p>
                                </div>

                                {/* Photos List if any */}
                                {photos.length > 0 && (
                                    <div className="space-y-4">
                                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Captured Photos ({photos.length})</p>
                                        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
                                            {photos.map((photo, i) => (
                                                <div key={i} className="relative flex-shrink-0">
                                                    <img src={photo} alt={`Pack photo ${i+1}`} className="w-24 h-24 object-cover rounded-2xl border border-white/10 shadow-lg" />
                                                    <button 
                                                        onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== i))}
                                                        className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center shadow-lg"
                                                    >
                                                        <X className="w-3 h-3 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </motion.div>
                        ) : cameraMode === 'scanning' ? (
                            <motion.div 
                                key="scanner"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="w-full max-w-lg aspect-[3/4] bg-black rounded-[3rem] border-4 border-white/10 overflow-hidden relative"
                            >
                                <div id="reader" className="w-full h-full" />
                                <div className="absolute inset-0 border-2 border-blue-500/30 m-12 rounded-2xl animate-pulse pointer-events-none" />
                                <button 
                                    onClick={() => setCameraMode('off')}
                                    className="absolute top-6 right-6 p-3 bg-black/50 backdrop-blur-md rounded-full text-white/70 hover:text-white"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                                <p className="absolute bottom-10 left-0 right-0 text-center text-xs font-black uppercase tracking-[0.2em] text-white/50">Align barcode within frame</p>
                            </motion.div>
                        ) : cameraMode === 'photo' ? (
                            <motion.div 
                                key="camera"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="w-full max-w-lg aspect-[3/4] bg-black rounded-[3rem] border-4 border-white/10 overflow-hidden relative flex flex-col"
                            >
                                <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
                                <canvas ref={canvasRef} className="hidden" />
                                
                                <div className="absolute top-6 left-6 right-6 flex justify-between items-center">
                                    <div className="px-4 py-2 bg-black/50 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2">
                                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-white/80">{scannedTracking || trackingNumber || 'NEW ORDER'}</p>
                                    </div>
                                    <div className="px-3 py-1 bg-blue-600 rounded-full text-[10px] font-black">
                                        {photos.length} PHOTOS
                                    </div>
                                </div>

                                <div className="absolute bottom-8 left-0 right-0 px-8 flex justify-between items-center">
                                    {/* Done Button (Bottom Left) */}
                                    <button 
                                        onClick={finishPacking}
                                        className="h-14 px-8 bg-emerald-600 rounded-2xl flex items-center justify-center font-black text-xs uppercase tracking-widest hover:bg-emerald-500 active:scale-95 transition-all shadow-lg shadow-emerald-600/20"
                                    >
                                        Done
                                    </button>

                                    <div className="flex flex-col items-center gap-4">
                                        <div className="px-4 py-1.5 bg-blue-600 rounded-xl border border-white/20 shadow-xl">
                                            <p className="text-[10px] font-black uppercase tracking-widest text-white">{mockDetails.boxSize}</p>
                                        </div>
                                        {/* Photo Button (Middle) */}
                                        <button 
                                            onClick={takePhoto}
                                            className="w-20 h-20 bg-white rounded-full flex items-center justify-center hover:scale-105 active:scale-90 transition-all shadow-2xl shadow-white/20 border-8 border-white/20"
                                        >
                                            <div className="w-12 h-12 rounded-full border-4 border-gray-900" />
                                        </button>
                                    </div>

                                    {/* Tracking Number Button/Display (Bottom Right) */}
                                    <div className="h-14 px-5 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/10 min-w-[120px]">
                                        <p className="font-mono text-xs font-bold text-white/80">...{(scannedTracking || trackingNumber || '000000').slice(-6)}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div 
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="flex-1 flex flex-col items-center justify-center text-center space-y-8"
                            >
                                <div className="w-32 h-32 bg-white/5 rounded-full flex items-center justify-center mx-auto relative">
                                    <div className="absolute inset-0 rounded-full border border-white/10 animate-ping" />
                                    <Package className="w-12 h-12 text-gray-600" />
                                </div>
                                <div className="space-y-3">
                                    <h1 className="text-3xl font-black text-white">Ready to pack</h1>
                                    <p className="text-sm text-gray-500 max-w-xs mx-auto">Scan a shipping label to view product details and packing instructions.</p>
                                </div>
                                
                                <button 
                                    onClick={startScanning}
                                    className="px-10 py-5 bg-blue-600 rounded-[2rem] flex items-center gap-4 hover:bg-blue-500 transition-all active:scale-95 shadow-xl shadow-blue-600/20"
                                >
                                    <CameraIcon className="w-6 h-6" />
                                    <span className="text-xs font-black uppercase tracking-widest">Start Scanning</span>
                                </button>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* 5. Thin Bar Progress Indicator (Bottom Fixed) */}
                <div className="absolute bottom-20 left-6 right-6 h-10 bg-gray-900/80 backdrop-blur-md rounded-full border border-white/10 flex items-center px-6 gap-6 z-20">
                    <p className="text-[10px] font-black text-gray-400 whitespace-nowrap">{todayCount} PACKED</p>
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min((todayCount / goal) * 100, 100)}%` }}
                            className="h-full bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        />
                    </div>
                    <p className="text-[10px] font-black text-gray-400 whitespace-nowrap">GOAL: {goal}</p>
                </div>

                {/* 6. Bottom Corners Buttons */}
                <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-between items-center bg-gradient-to-t from-gray-950 via-gray-950/80 to-transparent z-20">
                    <button 
                        onClick={() => {
                            if (scannedTracking || trackingNumber) {
                                setCameraMode('photo');
                                startCameraForPhoto();
                            } else {
                                startScanning();
                            }
                        }}
                        className="h-16 px-8 bg-white/5 backdrop-blur-md hover:bg-white/10 rounded-2xl border border-white/10 flex items-center gap-3 transition-all active:scale-95 group"
                    >
                        <CameraIcon className="w-5 h-5 text-gray-400 group-hover:text-white" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-white">
                            { (scannedTracking || trackingNumber) ? 'More Photos' : 'Open Camera' }
                        </span>
                    </button>

                    <button 
                        onClick={() => {
                            setTrackingNumber('');
                            setScannedTracking('');
                            setPhotos([]);
                            setShowDetails(false);
                            startScanning();
                        }}
                        className="h-16 px-8 bg-blue-600 rounded-2xl flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-blue-600/20"
                    >
                        <Search className="w-5 h-5 text-white" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white">New Scan</span>
                    </button>
                </div>
            </div>

            {/* Older Orders Sidebar (Right) */}
            <AnimatePresence>
                {showHistory && (
                    <>
                        <motion.div 
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setShowHistory(false)}
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm z-40"
                        />
                        <motion.div 
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="absolute right-0 top-0 bottom-0 w-96 bg-gray-900 border-l border-white/10 z-50 p-8"
                        >
                            <div className="flex justify-between items-center mb-10">
                                <h2 className="text-xl font-black uppercase tracking-widest">History</h2>
                                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/5 rounded-xl transition-all">
                                    <X className="w-6 h-6" />
                                </button>
                            </div>
                            
                            <div className="space-y-4 overflow-y-auto h-[calc(100vh-150px)] pr-2 scrollbar-hide">
                                {isLoadingHistory ? (
                                    <div className="flex flex-col items-center justify-center h-40 gap-3">
                                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                                        <p className="text-xs font-black uppercase tracking-widest text-gray-500">Loading History...</p>
                                    </div>
                                ) : history.length === 0 ? (
                                    <div className="text-center py-20">
                                        <Package className="w-12 h-12 text-gray-800 mx-auto mb-4" />
                                        <p className="text-xs font-black uppercase tracking-widest text-gray-600">No Orders Today</p>
                                    </div>
                                ) : (
                                    history.map((log: any) => (
                                        <div key={log.id} className="p-5 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 transition-all cursor-pointer group">
                                            <div className="flex justify-between items-start mb-2">
                                                <p className="font-mono text-sm font-bold text-gray-400 group-hover:text-white transition-colors">
                                                    {log.trackingNumber.length > 15 ? `${log.trackingNumber.slice(0, 12)}...` : log.trackingNumber}
                                                </p>
                                                <p className="text-[10px] font-black text-gray-600 uppercase">
                                                    {new Date(log.packedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Packed</p>
                                                </div>
                                                {log.photos && JSON.parse(log.photos).length > 0 && (
                                                    <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">
                                                        {JSON.parse(log.photos).length} Photos
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
