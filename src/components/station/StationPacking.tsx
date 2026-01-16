'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Search, Camera as CameraIcon, Package } from '../Icons';
import { AnimatePresence } from 'framer-motion';

// Import refactored sub-components
import { PackingProgress } from './packing/PackingProgress';
import { OrderDetails } from './packing/OrderDetails';
import { CameraScanner } from './packing/CameraScanner';
import { PhotoCapture } from './packing/PhotoCapture';
import { PhotoGallery } from './packing/PhotoGallery';

// Import hooks and utilities
import { getCarrier } from '@/utils/tracking';

interface StationPackingProps {
    packerId: string;
    onPacked: () => void;
    todayCount: number;
    goal: number;
}

type CameraMode = 'off' | 'scanning' | 'photo';

export default function StationPacking({ packerId, onPacked, todayCount, goal }: StationPackingProps) {
    const [cameraMode, setCameraMode] = useState<CameraMode>('off');
    const [scannedTracking, setScannedTracking] = useState('');
    const [photos, setPhotos] = useState<string[]>([]);
    const [showDetails, setShowDetails] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [orderDetails, setOrderDetails] = useState<any>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);
    
    const scannerRef = useRef<Html5Qrcode | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    
    const mockDetails = {
        productTitle: 'Sony Alpha a7 IV Mirrorless Camera',
        orderId: 'ORD-7721',
        boxSize: '12x12x12',
        instructions: 'Fragile. Wrap in double bubble wrap. Use heavy duty tape.',
    };

    useEffect(() => {
        return () => {
            if (scannerRef.current) {
                scannerRef.current.stop().catch(console.error);
            }
        };
    }, []);

    const startScanning = async () => {
        if (scannerRef.current) {
            try { await scannerRef.current.stop(); } catch (e) {}
            scannerRef.current = null;
        }
        setCameraMode('scanning');
        setShowDetails(false);
        setPhotos([]);
        setScannedTracking('');
        
        setTimeout(async () => {
            try {
                const element = document.getElementById("reader");
                if (!element) return;
                const html5QrCode = new Html5Qrcode("reader");
                scannerRef.current = html5QrCode;
                
                await html5QrCode.start(
                    { facingMode: "environment" },
                    { 
                        fps: 30,
                        qrbox: (viewfinderWidth, viewfinderHeight) => {
                            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                            return { width: minEdge * 0.8, height: minEdge * 0.4 };
                        },
                        aspectRatio: 1.0,
                        disableFlip: true,
                        videoConstraints: {
                            facingMode: "environment",
                            width: { ideal: 1920 },
                            height: { ideal: 1080 }
                        }
                    },
                    async (decodedText) => {
                        const cleanedText = decodedText.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                        
                        if (!cleanedText || cleanedText.length < 10) {
                            console.log('Invalid scan detected, skipping:', decodedText);
                            return;
                        }

                        setIsSearching(true);
                        setScannedTracking(cleanedText);
                        
                        try {
                            const res = await fetch(`/api/packing-logs/details?tracking=${encodeURIComponent(cleanedText)}`);
                            if (res.ok) {
                                const data = await res.json();
                                if (data.found) {
                                    await stopScanning();
                                    setOrderDetails(data);
                                    setIsSearching(false);
                                    setCameraMode('photo');
                                    startCameraForPhoto();
                                } else {
                                    console.log('Tracking not found in shipped sheet:', cleanedText);
                                    setIsSearching(false);
                                    setScannedTracking('');
                                }
                            } else {
                                setIsSearching(false);
                                setScannedTracking('');
                            }
                        } catch (e) {
                            console.error('Failed to fetch order details:', e);
                            setIsSearching(false);
                            setScannedTracking('');
                        }
                    },
                    (errorMessage) => {}
                );
            } catch (err) {
                console.error("Failed to start scanner:", err);
                if (scannerRef.current) {
                    try { await scannerRef.current.stop(); } catch (e) {}
                    scannerRef.current = null;
                }
                setTimeout(startScanning, 800);
            }
        }, 400);
    };

    const stopScanning = async () => {
        if (scannerRef.current) {
            try { 
                await scannerRef.current.stop(); 
                scannerRef.current = null; 
            } catch (err) {}
        }
    };

    const startCameraForPhoto = async () => {
        try {
            if (videoRef.current?.srcObject) {
                (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
                videoRef.current.srcObject = null;
            }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                } 
            });
            if (videoRef.current) videoRef.current.srcObject = stream;
        } catch (err) { 
            console.error("Failed to start photo camera:", err);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                if (videoRef.current) videoRef.current.srcObject = stream;
            } catch (e) { 
                console.error("Final fallback failed:", e); 
            }
        }
    };

    const takePhoto = async () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(video, 0, 0);
            
            const photoData = canvas.toDataURL('image/jpeg');
            
            // Save photo to file system
            try {
                const response = await fetch('/api/packing-logs/save-photo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        photo: photoData,
                        orderId: orderDetails?.orderId || mockDetails.orderId,
                        packerId: packerId,
                        photoIndex: photos.length
                    })
                });
                
                const result = await response.json();
                if (result.success) {
                    // Store the file path instead of base64
                    setPhotos(prev => [...prev, result.path]);
                } else {
                    // Fallback to base64 if save fails
                    setPhotos(prev => [...prev, photoData]);
                }
            } catch (err) {
                console.error('Error saving photo:', err);
                // Fallback to base64
                setPhotos(prev => [...prev, photoData]);
            }
        }
    };

    const finishPacking = async () => {
        if (videoRef.current?.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            videoRef.current.srcObject = null;
        }
        if (scannedTracking) {
            try {
                const now = new Date();
                // Format date as MM/DD/YYYY HH:mm:ss
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const year = now.getFullYear();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const seconds = String(now.getSeconds()).padStart(2, '0');
                const formattedDate = `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
                
                await fetch('/api/packing-logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trackingNumber: scannedTracking,
                        photos: photos, // Now contains file paths instead of base64
                        packerId: packerId,
                        orderId: orderDetails?.orderId || mockDetails.orderId,
                        boxSize: mockDetails.boxSize,
                        carrier: getCarrier(scannedTracking),
                        timestamp: formattedDate,
                        product: orderDetails?.productTitle || mockDetails.productTitle
                    })
                });
                onPacked();
            } catch (err) {
                console.error('Error finishing packing:', err);
            }
        }
        setCameraMode('off');
        setShowDetails(true);
    };

    const handleAddPhoto = () => {
        setCameraMode('photo');
        startCameraForPhoto();
    };

    const handleNewScan = () => {
        setScannedTracking('');
        setPhotos([]);
        setShowDetails(false);
        startScanning();
    };

    const handleViewPhotos = () => {
        setGalleryOpen(true);
    };

    const handleCloseScannerAndCamera = async () => {
        await stopScanning();
        setIsSearching(false);
        setScannedTracking('');
        setCameraMode('off');
    };

    const handleClosePhotoCamera = () => {
        if (videoRef.current?.srcObject) {
            (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
            videoRef.current.srcObject = null;
        }
        setCameraMode('off');
        setShowDetails(true);
    };

    return (
        <div className="flex-1 flex flex-col relative bg-white min-h-0">
            {/* Progress Header - Using Refactored Component */}
            <PackingProgress todayCount={todayCount} goal={goal} />

            <div className="flex-1 flex flex-col overflow-y-auto scrollbar-hide relative">
                <div className="flex-1 flex flex-col px-4 py-4 space-y-4">
                    {(scannedTracking || showDetails) && cameraMode === 'off' ? (
                        // Order Details - Using Refactored Component
                        <OrderDetails
                            orderDetails={orderDetails}
                            photos={photos}
                            onAddPhoto={handleAddPhoto}
                            onNewScan={handleNewScan}
                            onViewPhotos={handleViewPhotos}
                        />
                    ) : (
                        // Empty State
                        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-12 py-12 min-h-[70vh]">
                            <div className="w-32 h-32 bg-gray-50 rounded-full flex items-center justify-center mx-auto relative border border-gray-100">
                                <div className="absolute inset-0 rounded-full border border-blue-100 animate-ping" />
                                <Package className="w-12 h-12 text-gray-300" />
                            </div>
                            
                            <div className="space-y-3">
                                <h1 className="text-3xl font-black text-gray-900 leading-tight tracking-tighter">Ready to begin</h1>
                                <p className="text-sm text-gray-500 max-w-xs mx-auto">Scan the shipping label to start</p>
                            </div>

                            <div className="w-full max-w-xs space-y-8">
                                <div className="flex justify-center items-center gap-4">
                                    <button 
                                        onClick={startScanning} 
                                        className="h-16 px-8 bg-white border border-gray-100 rounded-2xl flex items-center gap-3 transition-all active:scale-95 group shadow-xl shadow-gray-200"
                                    >
                                        <CameraIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 group-hover:text-gray-900">Camera</span>
                                    </button>
                                    <button 
                                        onClick={startScanning} 
                                        className="h-16 px-8 bg-blue-600 rounded-2xl flex items-center gap-3 transition-all active:scale-95 shadow-xl shadow-blue-200 text-white font-black uppercase tracking-widest text-xs"
                                    >
                                        <Search className="w-5 h-5" />
                                        New Scan
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <AnimatePresence>
                    {/* Camera Scanner - Using Refactored Component */}
                    {cameraMode === 'scanning' && (
                        <CameraScanner
                            isSearching={isSearching}
                            onClose={handleCloseScannerAndCamera}
                        />
                    )}
                    
                    {/* Photo Capture - Using Refactored Component */}
                    {cameraMode === 'photo' && (
                        <PhotoCapture
                            videoRef={videoRef}
                            canvasRef={canvasRef}
                            scannedTracking={scannedTracking}
                            photosCount={photos.length}
                            onTakePhoto={takePhoto}
                            onFinish={finishPacking}
                            onClose={handleClosePhotoCamera}
                        />
                    )}

                    {/* Photo Gallery - Using Refactored Component */}
                    {galleryOpen && (
                        <PhotoGallery
                            photos={photos}
                            orderId={orderDetails?.orderId || mockDetails.orderId}
                            onClose={() => setGalleryOpen(false)}
                        />
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
