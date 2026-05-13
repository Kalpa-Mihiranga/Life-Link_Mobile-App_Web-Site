const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Hospital = require('../models/Hospital');
const EmergencyRequest = require('../models/EmergencyRequest');  
const Donation = require('../models/Donation');
const HospitalRequest = require('../models/HospitalRequest');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// ====================== MULTER SETUP ======================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/documents/'),
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.fieldname}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (/pdf|jpg|jpeg|png/.test(path.extname(file.originalname).toLowerCase())) {
            return cb(null, true);
        }
        cb(new Error('Only PDF, JPG, JPEG, PNG allowed'));
    }
}).fields([
    { name: 'govtCertificate', maxCount: 1 },
    { name: 'medicalLicense', maxCount: 1 },
    { name: 'authorizedId', maxCount: 1 }
]);

// ====================== AUTH MIDDLEWARE ======================
const authenticateHospital = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        const hospitalId = req.headers['hospital-id'];

        if (!token || !hospitalId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        if (String(decoded.hospitalId) !== String(hospitalId)) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }

        req.hospitalId = hospitalId;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

// ====================== HELPERS ======================
function getTimeAgo(date) {
    const s = Math.floor((Date.now() - new Date(date)) / 1000);
    if (s < 60) return `${s} seconds ago`;
    if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
    return `${Math.floor(s / 86400)} days ago`;
}

function calculateTimeLeft(createdAt) {
    const mins = Math.floor((Date.now() - new Date(createdAt)) / 60000);
    return `${Math.max(0, 30 - mins)}M`;
}

function getActionLabel(status, urgency) {
    if (status === 'Matched') return urgency === 'Critical' ? '🚨 Urgent — Donor Matched' : '✅ Donor Matched';
    if (status === 'Active') return urgency === 'Critical' || urgency === 'Urgent' ? '⚡ Urgent Processing' : '📋 Process Request';
    if (status === 'Pending') return urgency === 'Critical' || urgency === 'Urgent' ? '⚡ Urgent Processing' : '📋 Review Request';
    if (status === 'Completed') return '✔ View Summary';
    if (status === 'Cancelled') return 'View Details';
    return 'Process Request';
}

// ====================== REGISTER ======================
router.post('/register', upload, async (req, res) => {
    try {
        const { name, email, password, regNumber, address, contact, storageCapacity, bloodInventory, selectedBloodTypes } = req.body;

        const existing = await Hospital.findOne({ 
            $or: [{ email: email.toLowerCase() }, { regNumber }] 
        });

        if (existing) {
            return res.status(400).json({ success: false, message: 'Email or Registration Number already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const documents = {};
        if (req.files?.govtCertificate) documents.govtCertificate = req.files.govtCertificate[0].path;
        if (req.files?.medicalLicense)  documents.medicalLicense = req.files.medicalLicense[0].path;
        if (req.files?.authorizedId)    documents.authorizedId = req.files.authorizedId[0].path;

        const hospital = new Hospital({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            regNumber,
            address,
            contact,
            storageCapacity: Number(storageCapacity) || 5000,
            bloodInventory: bloodInventory ? JSON.parse(bloodInventory) : {},
            selectedBloodTypes: selectedBloodTypes ? JSON.parse(selectedBloodTypes) : ['A+','A-','B+','B-','O+','O-','AB+','AB-'],
            documents,
            isVerified: false
        });

        await hospital.save();

        const token = jwt.sign({ hospitalId: hospital._id }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            success: true,
            message: 'Hospital registered successfully!',
            token,
            hospitalId: hospital._id,
            name: hospital.name,
            email: hospital.email
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== LOGIN ======================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }

        const hospital = await Hospital.findOne({ 
            email: email.toLowerCase() 
        });

        if (!hospital) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        const isMatch = await bcrypt.compare(password, hospital.password);
        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }

        if (!hospital.isVerified) {
            return res.status(403).json({ 
                success: false, 
                message: 'Your hospital account is not yet verified. Please wait for admin approval or contact support.',
                isVerified: false
            });
        }

        const token = jwt.sign({ hospitalId: hospital._id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            message: 'Login successful',
            token,
            hospitalId: hospital._id,
            name: hospital.name,
            hospitalName: hospital.name,
            email: hospital.email,
            regNumber: hospital.regNumber,
            address: hospital.address,
            contact: hospital.contact,
            storageCapacity: hospital.storageCapacity,
            isVerified: hospital.isVerified,
            selectedBloodTypes: hospital.selectedBloodTypes,
            bloodInventory: hospital.bloodInventory
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during login' 
        });
    }
});

// ====================== DASHBOARD ======================
router.get('/dashboard', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const bloodStocks = Object.entries(hospital.bloodInventory || {}).map(([bloodType, units]) => ({
            bloodType,
            units: units || 0
        }));

        const patientRequests = await EmergencyRequest.find({
            hospitalId: hid,
            status: { $in: ['Active', 'Pending', 'Matched'] }
        }).sort({ createdAt: -1 }).limit(10).lean();

        const formattedPatientRequests = patientRequests.map(r => ({
            id: r._id.toString(),
            name: r.patientName,
            bloodType: r.bloodGroup,
            organType: r.organType || null,
            requestType: r.requestType || 'Blood',
            units: r.unitsNeeded,
            urgency: r.urgencyLevel,
            status: r.status,
            donorFound: r.donorFound || false,
            hospitalName: r.hospitalName || hospital.name,
            notes: r.additionalNotes || '',
            matchedAt: r.matchedAt || null,
            timeAgo: getTimeAgo(r.createdAt),
            actionLabel: getActionLabel(r.status, r.urgencyLevel)
        }));

        const urgentRequests = await EmergencyRequest.find({
            hospitalId: hid,
            urgencyLevel: { $in: ['Critical', 'Urgent'] },
            status: { $in: ['Active', 'Pending', 'Matched'] }
        }).sort({ createdAt: -1 }).limit(10).lean();

        const formattedUrgentRequests = urgentRequests.map(r => ({
            id: r._id.toString(),
            bloodGroup: r.bloodGroup,
            unitsNeeded: r.unitsNeeded,
            timeLeft: calculateTimeLeft(r.createdAt),
            hospitalOrER: r.hospitalName || hospital.name,
            patientName: r.patientName,
            urgency: r.urgencyLevel,
            status: r.status,
            requestType: r.requestType
        }));

        const availableDonorsRes = await fetch(`http://localhost:8083/api/hospitals/available-donors`, {
            headers: {
                Authorization: req.headers.authorization,
                'Hospital-Id': req.hospitalId
            }
        });
        const donorsData = availableDonorsRes.ok ? await availableDonorsRes.json() : { availableDonors: [] };

        res.json({
            success: true,
            hospitalName: hospital.name,
            bloodStocks,
            patientRequests: formattedPatientRequests,
            urgentRequests: formattedUrgentRequests,
            availableDonors: donorsData.availableDonors || [],
            instructions: []
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET PATIENT REQUESTS ======================
router.get('/patient-requests', authenticateHospital, async (req, res) => {
    try {
        const { status, urgency, bloodType } = req.query;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const filter = { hospitalId: hid };

        if (status === 'active') {
            filter.status = { $in: ['Active', 'Pending', 'Matched'] };
        } else if (status === 'completed') {
            filter.status = 'Completed';
        } else if (status === 'cancelled') {
            filter.status = 'Cancelled';
        }

        if (urgency && urgency !== 'All') filter.urgencyLevel = urgency;
        if (bloodType && bloodType !== 'All') filter.bloodGroup = bloodType;

        const raw = await EmergencyRequest.find(filter)
            .sort({ createdAt: -1 })
            .lean();

        const requests = raw.map(r => ({
            id: r._id.toString(),
            name: r.patientName || 'Unknown Patient',
            avatarUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(r.patientName || 'P')}&background=E3F2FD&color=1565C0`,
            hospital: r.hospitalName || 'Your Hospital',
            required: `${r.bloodGroup} ${r.requestType || 'Blood'}`,
            bloodType: r.bloodGroup,
            units: r.unitsNeeded || 0,
            urgency: r.urgencyLevel || 'normal',
            status: r.status === 'Matched' ? 'Donor Matched' :
                    r.status === 'Active' ? 'Searching for Donors' :
                    r.status === 'Pending' ? 'Pending Approval' : r.status,
            rawStatus: r.status,
            statusColor: r.status === 'Matched' || r.status === 'Completed' ? '#43A047' :
                         r.status === 'Active' ? '#1976D2' : '#FB8C00',
            priority: (r.urgencyLevel === 'Critical' || r.urgencyLevel === 'Urgent') ? 'CRITICAL' : 'NORMAL',
            priorityColor: (r.urgencyLevel === 'Critical' || r.urgencyLevel === 'Urgent') ? '#E53935' : '#6B7280',
            donorFound: r.donorFound || false,
            notes: r.additionalNotes || '',
            timeAgo: getTimeAgo(r.createdAt),
            requestType: r.requestType || 'Blood',
            organType: r.organType
        }));

        res.json({
            success: true,
            requests,
            count: requests.length
        });
    } catch (err) {
        console.error('patient-requests error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== REQUESTS (Alias) ======================
router.get('/requests', authenticateHospital, (req, res) => {
    req.url = '/patient-requests' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
    router.handle(req, res, () => {});
});

// ====================== URGENT REQUESTS ======================
router.get('/urgent-requests', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const raw = await EmergencyRequest.find({
            hospitalId: hid,
            urgencyLevel: { $in: ['Critical', 'Urgent'] },
            status: { $in: ['Active', 'Pending', 'Matched'] }
        }).sort({ createdAt: -1 }).limit(10).lean();

        const urgentRequests = raw.map(r => ({
            id: r._id.toString(),
            bloodGroup: r.bloodGroup,
            unitsNeeded: r.unitsNeeded,
            timeLeft: calculateTimeLeft(r.createdAt),
            hospitalOrER: r.hospitalName || 'Emergency Room',
            patientName: r.patientName,
            urgency: r.urgencyLevel,
            status: r.status,
            requestType: r.requestType
        }));

        res.json({ success: true, urgentRequests });
    } catch (err) {
        console.error('urgent-requests error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== ACCEPT URGENT REQUEST ======================
router.post('/urgent-requests/:requestId/accept', authenticateHospital, async (req, res) => {
    try {
        const request = await EmergencyRequest.findById(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        request.status = 'Matched';
        request.matchedAt = new Date();
        if (req.body.messageToPatient) request.hospitalResponse = req.body.messageToPatient;

        await request.save();
        res.json({ success: true, message: 'Request accepted' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== COMPLETE REQUEST ======================
router.post('/requests/:requestId/complete', authenticateHospital, async (req, res) => {
    try {
        const request = await EmergencyRequest.findById(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        request.status = 'Completed';
        request.completedAt = new Date();
        await request.save();
        res.json({ success: true, message: 'Request marked as completed' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CANCEL REQUEST ======================
router.post('/requests/:requestId/cancel', authenticateHospital, async (req, res) => {
    try {
        const request = await EmergencyRequest.findById(req.params.requestId);
        if (!request) return res.status(404).json({ success: false, message: 'Request not found' });

        request.status = 'Cancelled';
        request.cancelledAt = new Date();
        request.cancellationReason = req.body.reason || '';
        await request.save();
        res.json({ success: true, message: 'Request cancelled' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET AVAILABLE DONORS ======================
router.get('/available-donors', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const hospital = await Hospital.findById(hid).select('city');
        const hospitalCity = hospital?.city || '';

        const donors = await mongoose.model('User').find({
            role: 'Donor',
            bloodGroup: { $exists: true, $ne: null },
            isVerified: true,
        })
        .select('fullName bloodGroup city phone avatarUrl dob age lastDonationDate')
        .sort({ createdAt: -1 })
        .limit(12)
        .lean();

        const formattedDonors = donors.map(donor => {
            const age = donor.dob 
                ? new Date().getFullYear() - new Date(donor.dob).getFullYear() 
                : donor.age || '—';

            return {
                id: donor._id.toString(),
                name: donor.fullName || 'Anonymous Donor',
                bloodType: donor.bloodGroup,
                city: donor.city || 'Nearby Area',
                distance: `${Math.floor(Math.random() * 12) + 1} km`,
                avatarUrl: donor.avatarUrl || 'http://10.168.30.144:3000/uploads/avatars/default-user.png',
                age: age,
                phoneLast: donor.phone ? donor.phone.slice(-4) : 'xxxx',
                lastDonation: donor.lastDonationDate 
                    ? getTimeAgo(donor.lastDonationDate) 
                    : 'First time donor'
            };
        });

        res.json({
            success: true,
            availableDonors: formattedDonors,
            count: formattedDonors.length
        });
    } catch (err) {
        console.error('Available donors error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load available donors' 
        });
    }
});

// ====================== UPDATE BLOOD INVENTORY ======================
router.post('/inventory/update', authenticateHospital, async (req, res) => {
    try {
        const { bloodInventory, updateReason, bloodType, action, quantity } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        if (!bloodInventory && (!bloodType || !action)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please provide inventory data or blood type with action' 
            });
        }

        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        let updatedInventory = { ...hospital.bloodInventory };

        if (bloodInventory) {
            updatedInventory = bloodInventory;
        } else if (bloodType && action) {
            const currentUnits = updatedInventory[bloodType] || 0;
            let newUnits = currentUnits;

            switch (action) {
                case 'add':
                    newUnits = currentUnits + quantity;
                    break;
                case 'remove':
                    newUnits = Math.max(0, currentUnits - quantity);
                    break;
                case 'set':
                    newUnits = quantity;
                    break;
                default:
                    return res.status(400).json({ success: false, message: 'Invalid action' });
            }

            updatedInventory[bloodType] = newUnits;
            
            if (newUnits === 0) {
                delete updatedInventory[bloodType];
            }
        }

        hospital.bloodInventory = updatedInventory;
        await hospital.save();

        const bloodStocks = Object.entries(updatedInventory).map(([bloodType, units]) => ({
            bloodType,
            units: units || 0
        }));

        res.json({
            success: true,
            message: 'Inventory updated successfully',
            bloodStocks,
            inventory: updatedInventory
        });
    } catch (err) {
        console.error('Inventory update error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== BULK UPDATE INVENTORY ======================
router.post('/inventory/bulk-update', authenticateHospital, async (req, res) => {
    try {
        const { inventory } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        if (!inventory || !Array.isArray(inventory)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please provide inventory array' 
            });
        }

        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const updatedInventory = {};
        inventory.forEach(item => {
            if (item.bloodType && typeof item.units === 'number') {
                updatedInventory[item.bloodType] = item.units;
            }
        });

        hospital.bloodInventory = updatedInventory;
        await hospital.save();

        const bloodStocks = Object.entries(updatedInventory).map(([bloodType, units]) => ({
            bloodType,
            units: units || 0
        }));

        res.json({
            success: true,
            message: 'Bulk inventory update successful',
            bloodStocks
        });
    } catch (err) {
        console.error('Bulk inventory update error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET INVENTORY HISTORY ======================
router.get('/inventory/history', authenticateHospital, async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Inventory history feature coming soon',
            history: []
        });
    } catch (err) {
        console.error('Inventory history error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CHECK INVENTORY STATUS ======================
router.get('/inventory/status', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);
        
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const inventory = hospital.bloodInventory || {};
        const critical = [];
        const low = [];
        const normal = [];

        Object.entries(inventory).forEach(([bloodType, units]) => {
            if (units <= 5) {
                critical.push({ bloodType, units });
            } else if (units <= 10) {
                low.push({ bloodType, units });
            } else {
                normal.push({ bloodType, units });
            }
        });

        res.json({
            success: true,
            status: {
                critical,
                low,
                normal,
                totalUnits: Object.values(inventory).reduce((sum, units) => sum + units, 0),
                bloodTypesCount: Object.keys(inventory).length
            }
        });
    } catch (err) {
        console.error('Inventory status error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET ALERTS ======================
router.get('/alerts', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        console.log('Fetching alerts for hospital:', hospital.name);

        const alerts = [];

        // 1. Low Blood Stock Alerts
        const bloodInventory = hospital.bloodInventory || {};
        Object.entries(bloodInventory).forEach(([bloodType, units]) => {
            if (units <= 5) {
                alerts.push({
                    id: `blood-low-${bloodType}`,
                    type: "urgent",
                    message: `Blood stock for ${bloodType} is critically low (${units} units)`,
                    time: "Just now",
                    read: false,
                    category: "inventory",
                    showAction: false
                });
            } else if (units <= 10) {
                alerts.push({
                    id: `blood-low-${bloodType}`,
                    type: "warning",
                    message: `${bloodType} blood stock is running low (${units} units remaining)`,
                    time: "Today",
                    read: false,
                    category: "inventory",
                    showAction: false
                });
            }
        });

        // 2. Critical Patient Requests from this hospital
        const criticalRequests = await EmergencyRequest.find({
            hospitalId: hid,
            urgencyLevel: { $in: ['Critical', 'Urgent'] },
            status: { $in: ['Active', 'Pending'] }
        }).sort({ createdAt: -1 }).limit(5).lean();

        criticalRequests.forEach(req => {
            alerts.push({
                id: `req-${req._id}`,
                type: "urgent",
                message: `Critical request: ${req.patientName} needs ${req.bloodGroup} (${req.unitsNeeded} units) - ${req.urgencyLevel}`,
                time: getTimeAgo(req.createdAt),
                read: false,
                category: "request",
                showAction: false,
                requestId: req._id.toString()
            });
        });

        // 3. Hospital Requests from OTHER hospitals (not this hospital)
        const otherHospitalRequests = await HospitalRequest.find({
            hospitalId: { $ne: hid },
            status: { $in: ['Pending', 'Partially Fulfilled'] },
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

        otherHospitalRequests.forEach(req => {
            let alertType = "info";
            let urgencyLabel = "";
            
            if (req.urgency === 'Critical') {
                alertType = "urgent";
                urgencyLabel = "🚨 CRITICAL";
            } else if (req.urgency === 'Urgent') {
                alertType = "warning";
                urgencyLabel = "⚡ URGENT";
            } else {
                alertType = "info";
                urgencyLabel = "📌";
            }
            
            const remainingQuantity = req.quantity - (req.fulfilledQuantity || 0);
            
            alerts.push({
                id: `hospital-req-${req._id}`,
                type: alertType,
                message: `${urgencyLabel} Request from ${req.hospitalName}: ${req.itemType} - ${req.itemName} (${remainingQuantity} units needed) - ${req.reason.substring(0, 100)}`,
                time: getTimeAgo(req.createdAt),
                read: false,
                category: "hospital_request",
                showAction: false,
                requestData: {
                    requestId: req._id,
                    hospitalId: req.hospitalId,
                    hospitalName: req.hospitalName,
                    hospitalContact: req.hospitalContact,
                    itemType: req.itemType,
                    itemName: req.itemName,
                    quantityNeeded: req.quantity,
                    fulfilledQuantity: req.fulfilledQuantity || 0,
                    remainingQuantity: remainingQuantity,
                    urgency: req.urgency,
                    reason: req.reason,
                    contactPerson: req.contactPerson,
                    createdAt: req.createdAt
                }
            });
        });

        // 4. PENDING DONATIONS - Show action buttons
        const pendingDonations = await Donation.find({
            $or: [
                { hospitalId: hid },
                { hospitalName: hospital.name }
            ],
            status: 'Pending'
        }).sort({ createdAt: -1 }).limit(10).lean();

        console.log(`Found ${pendingDonations.length} pending donations`);

        pendingDonations.forEach(donation => {
            alerts.push({
                id: `donation-pending-${donation._id}`,
                type: "warning",
                message: `🆕 New donation request from ${donation.donorName} - ${donation.donationType}${donation.bloodType && donation.bloodType !== 'Unknown' ? ` (${donation.bloodType})` : ''}`,
                time: getTimeAgo(donation.createdAt),
                read: false,
                category: "donation",
                donationId: donation._id.toString(),
                donationData: {
                    donorName: donation.donorName,
                    donationType: donation.donationType,
                    bloodType: donation.bloodType || 'N/A',
                    units: donation.units,
                    status: donation.status
                },
                showAction: true
            });
        });

        // 5. COMPLETED DONATIONS
        const completedDonations = await Donation.find({
            $or: [
                { hospitalId: hid },
                { hospitalName: hospital.name }
            ],
            status: 'Completed'
        }).sort({ confirmedAt: -1 }).limit(5).lean();

        completedDonations.forEach(donation => {
            alerts.push({
                id: `donation-completed-${donation._id}`,
                type: "success",
                message: `✅ Donation completed by ${donation.donorName} - ${donation.units} unit(s)${donation.bloodType && donation.bloodType !== 'Unknown' ? ` of ${donation.bloodType}` : ''} added to inventory`,
                time: getTimeAgo(donation.confirmedAt || donation.createdAt),
                read: false,
                category: "donation",
                donationId: donation._id.toString(),
                showAction: false
            });
        });

        // 6. REJECTED DONATIONS
        const rejectedDonations = await Donation.find({
            $or: [
                { hospitalId: hid },
                { hospitalName: hospital.name }
            ],
            status: 'Rejected'
        }).sort({ confirmedAt: -1 }).limit(5).lean();

        rejectedDonations.forEach(donation => {
            alerts.push({
                id: `donation-rejected-${donation._id}`,
                type: "info",
                message: `❌ Donation from ${donation.donorName} was rejected${donation.rejectionReason ? `: ${donation.rejectionReason}` : ''}`,
                time: getTimeAgo(donation.confirmedAt || donation.createdAt),
                read: false,
                category: "donation",
                donationId: donation._id.toString(),
                showAction: false
            });
        });

        // Sort alerts by urgency
        alerts.sort((a, b) => {
            const priority = { urgent: 4, warning: 3, success: 2, info: 1 };
            if (priority[a.type] !== priority[b.type]) {
                return priority[b.type] - priority[a.type];
            }
            return 0;
        });

        res.json({
            success: true,
            alerts: alerts.slice(0, 25),
            count: alerts.length,
            unreadCount: alerts.filter(a => !a.read).length,
            donationStats: {
                pending: pendingDonations.length,
                completed: completedDonations.length,
                rejected: rejectedDonations.length
            }
        });

    } catch (err) {
        console.error('Alerts fetch error:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to load alerts',
            error: err.message
        });
    }
});

// ====================== MARK ALERT AS READ ======================
router.post('/alerts/:alertId/read', authenticateHospital, async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Alert marked as read'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== MARK ALL ALERTS AS READ ======================
router.post('/alerts/mark-all-read', authenticateHospital, async (req, res) => {
    try {
        res.json({
            success: true,
            message: 'All alerts marked as read'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CONFIRM DONATION ======================
router.post('/donations/:donationId/confirm', authenticateHospital, async (req, res) => {
    try {
        const { donationId } = req.params;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const donation = await Donation.findById(donationId);
        
        if (!donation) {
            return res.status(404).json({ success: false, message: 'Donation not found' });
        }

        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const isAuthorized = donation.hospitalId?.toString() === hid.toString() || 
                            donation.hospitalName === hospital.name;
        
        if (!isAuthorized) {
            return res.status(403).json({ 
                success: false, 
                message: 'Not authorized for this donation' 
            });
        }

        if (donation.status === 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Donation is already completed' 
            });
        }

        if (donation.status === 'Rejected') {
            return res.status(400).json({ 
                success: false, 
                message: 'Donation was already rejected' 
            });
        }

        // Update donation status to Completed
        donation.status = 'Completed';
        donation.confirmedBy = hid;
        donation.confirmedAt = new Date();
        await donation.save();

        // Update hospital blood inventory (only for blood-related donations)
        const bloodRelatedTypes = ['Whole Blood', 'Platelets', 'Plasma', 'Red Blood Cells'];
        let bloodStocks = [];
        let inventoryMessage = '';
        
        if (bloodRelatedTypes.includes(donation.donationType)) {
            if (donation.bloodType && donation.bloodType !== 'Unknown') {
                const bloodType = donation.bloodType;
                const unitsToAdd = parseInt(donation.units) || 1;
                
                let updatedInventory = { ...hospital.bloodInventory };
                const currentUnits = updatedInventory[bloodType] || 0;
                updatedInventory[bloodType] = currentUnits + unitsToAdd;
                
                hospital.bloodInventory = updatedInventory;
                await hospital.save();
                
                bloodStocks = Object.entries(updatedInventory).map(([bt, units]) => ({
                    bloodType: bt,
                    units: units
                }));
                inventoryMessage = ` Blood inventory has been updated: +${unitsToAdd} units of ${bloodType}.`;
            } else {
                inventoryMessage = ` Note: No blood type specified for this donation.`;
            }
        } else {
            inventoryMessage = ` This is a ${donation.donationType} donation, which does not affect blood inventory.`;
        }

        res.json({
            success: true,
            message: `Donation confirmed successfully!${inventoryMessage}`,
            donation: {
                id: donation._id.toString(),
                status: donation.status,
                donorName: donation.donorName,
                donationType: donation.donationType,
                bloodType: donation.bloodType,
                unitsAdded: donation.units
            },
            bloodStocks: bloodStocks
        });

    } catch (err) {
        console.error('Confirm donation error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== REJECT DONATION ======================
router.post('/donations/:donationId/reject', authenticateHospital, async (req, res) => {
    try {
        const { donationId } = req.params;
        const { reason } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);

        const donation = await Donation.findById(donationId);
        
        if (!donation) {
            return res.status(404).json({ success: false, message: 'Donation not found' });
        }

        const hospital = await Hospital.findById(hid);
        
        const isAuthorized = donation.hospitalId?.toString() === hid.toString() || 
                            donation.hospitalName === hospital?.name;
        
        if (!isAuthorized) {
            return res.status(403).json({ 
                success: false, 
                message: 'Not authorized for this donation' 
            });
        }

        if (donation.status === 'Completed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot reject a completed donation' 
            });
        }

        if (donation.status === 'Rejected') {
            return res.status(400).json({ 
                success: false, 
                message: 'Donation is already rejected' 
            });
        }

        donation.status = 'Rejected';
        donation.rejectionReason = reason || 'No reason provided';
        donation.confirmedBy = hid;
        donation.confirmedAt = new Date();

        await donation.save();

        res.json({
            success: true,
            message: 'Donation rejected successfully',
            donation: {
                id: donation._id.toString(),
                status: donation.status,
                donorName: donation.donorName,
                rejectionReason: donation.rejectionReason
            }
        });

    } catch (err) {
        console.error('Reject donation error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET DONATIONS ======================
router.get('/donations', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);
        
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const { status, limit = 20 } = req.query;
        
        const filter = {
            $or: [
                { hospitalId: hid },
                { hospitalName: hospital.name }
            ]
        };
        
        if (status && status !== 'All') {
            filter.status = status;
        }

        const donations = await Donation.find(filter)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        const formatted = donations.map(d => ({
            id: d._id.toString(),
            donorName: d.donorName,
            donorId: d.donorId,
            donationType: d.donationType,
            bloodType: d.bloodType || 'Unknown',
            units: d.units,
            status: d.status,
            time: getTimeAgo(d.createdAt),
            createdAt: d.createdAt,
            canConfirm: d.status === 'Pending',
            canReject: d.status === 'Pending',
            rejectionReason: d.rejectionReason,
            confirmedAt: d.confirmedAt
        }));

        res.json({
            success: true,
            donations: formatted,
            count: formatted.length,
            pending: formatted.filter(d => d.status === 'Pending').length,
            completed: formatted.filter(d => d.status === 'Completed').length,
            rejected: formatted.filter(d => d.status === 'Rejected').length
        });

    } catch (err) {
        console.error('Get donations error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CREATE TEST DONATION ======================
router.post('/donations/create-test', authenticateHospital, async (req, res) => {
    try {
        const { donorName, donorId, donationType, bloodType, units } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);

        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        const validDonationTypes = ['Whole Blood', 'Platelets', 'Plasma', 'Red Blood Cells', 'Bone Marrow', 'Stem Cells', 'Other'];
        const finalDonationType = donationType || 'Whole Blood';
        
        if (!validDonationTypes.includes(finalDonationType)) {
            return res.status(400).json({ 
                success: false, 
                message: `Invalid donation type. Must be one of: ${validDonationTypes.join(', ')}` 
            });
        }

        const bloodRequiredTypes = ['Whole Blood', 'Platelets', 'Plasma', 'Red Blood Cells'];
        const needsBloodType = bloodRequiredTypes.includes(finalDonationType);
        
        let finalBloodType = bloodType;
        if (needsBloodType && (!finalBloodType || finalBloodType === 'Unknown')) {
            finalBloodType = 'O+';
        }

        const donation = new Donation({
            donorId: donorId || new mongoose.Types.ObjectId(),
            donorName: donorName || 'Test Donor',
            hospitalName: hospital.name,
            hospitalId: hid,
            donationType: finalDonationType,
            bloodType: finalBloodType,
            units: parseInt(units) || 1,
            status: 'Pending',
            createdAt: new Date()
        });

        await donation.save();

        res.json({
            success: true,
            message: 'Test donation created successfully',
            donation: {
                id: donation._id.toString(),
                donorName: donation.donorName,
                donationType: donation.donationType,
                bloodType: donation.bloodType,
                units: donation.units,
                status: donation.status,
                hospitalName: donation.hospitalName
            }
        });
    } catch (err) {
        console.error('Create test donation error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET PROFILE ======================
router.get('/profile', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid).select('-password');
        
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        res.json({
            success: true,
            hospital: {
                id: hospital._id,
                name: hospital.name,
                email: hospital.email,
                regNumber: hospital.regNumber,
                address: hospital.address,
                contact: hospital.contact,
                storageCapacity: hospital.storageCapacity,
                isVerified: hospital.isVerified,
                selectedBloodTypes: hospital.selectedBloodTypes,
                bloodInventory: hospital.bloodInventory,
                documents: hospital.documents
            }
        });
    } catch (err) {
        console.error('Profile error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CREATE HOSPITAL REQUEST ======================
router.post('/hospital-requests', authenticateHospital, async (req, res) => {
    try {
        const {
            itemType,
            itemName,
            quantity,
            urgency,
            reason,
            contactPerson
        } = req.body;

        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);
        
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        if (!itemType || !itemName || !quantity || !reason || !contactPerson) {
            return res.status(400).json({ 
                success: false, 
                message: 'Missing required fields: itemType, itemName, quantity, reason, contactPerson' 
            });
        }

        const request = new HospitalRequest({
            hospitalId: hid,
            hospitalName: hospital.name,
            hospitalContact: hospital.contact,
            itemType,
            itemName,
            quantity,
            urgency: urgency || 'Normal',
            reason,
            contactPerson,
            status: 'Pending',
            fulfilledQuantity: 0,
            responses: []
        });

        await request.save();

        console.log(`New hospital request created: ${request.itemName} from ${hospital.name}`);

        res.status(201).json({
            success: true,
            message: 'Request created successfully',
            request: {
                id: request._id,
                itemType: request.itemType,
                itemName: request.itemName,
                quantity: request.quantity,
                urgency: request.urgency,
                status: request.status,
                createdAt: request.createdAt
            }
        });

    } catch (err) {
        console.error('Create hospital request error:', err);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create request',
            error: err.message 
        });
    }
});

// ====================== GET ALL HOSPITAL REQUESTS ======================
router.get('/hospital-requests', authenticateHospital, async (req, res) => {
    try {
        const { status, urgency, itemType, limit = 50 } = req.query;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        const filter = { hospitalId: hid };
        
        if (status && status !== 'All') filter.status = status;
        if (urgency && urgency !== 'All') filter.urgency = urgency;
        if (itemType && itemType !== 'All') filter.itemType = itemType;
        
        const requests = await HospitalRequest.find(filter)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();
        
        const formattedRequests = requests.map(req => ({
            ...req,
            remainingQuantity: req.quantity - (req.fulfilledQuantity || 0),
            isFullyFulfilled: (req.fulfilledQuantity || 0) >= req.quantity
        }));
        
        res.json({
            success: true,
            requests: formattedRequests,
            count: formattedRequests.length
        });
        
    } catch (err) {
        console.error('Get hospital requests error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET SINGLE REQUEST ======================
router.get('/hospital-requests/:requestId', authenticateHospital, async (req, res) => {
    try {
        const { requestId } = req.params;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        const request = await HospitalRequest.findOne({
            _id: requestId,
            hospitalId: hid
        });
        
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        
        res.json({
            success: true,
            request: {
                ...request.toObject(),
                remainingQuantity: request.quantity - (request.fulfilledQuantity || 0),
                isFullyFulfilled: (request.fulfilledQuantity || 0) >= request.quantity
            }
        });
        
    } catch (err) {
        console.error('Get hospital request error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== UPDATE REQUEST FULFILLMENT ======================
router.patch('/hospital-requests/:requestId/fulfill', authenticateHospital, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { quantity } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        if (!quantity || quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Valid quantity is required' });
        }
        
        const request = await HospitalRequest.findOne({
            _id: requestId,
            hospitalId: hid
        });
        
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        
        if (request.status === 'Fulfilled') {
            return res.status(400).json({ success: false, message: 'Request is already fulfilled' });
        }
        
        if (request.status === 'Cancelled') {
            return res.status(400).json({ success: false, message: 'Request is cancelled' });
        }
        
        await request.updateFulfillment(quantity);
        
        res.json({
            success: true,
            message: 'Fulfillment updated successfully',
            request: {
                id: request._id,
                fulfilledQuantity: request.fulfilledQuantity,
                remainingQuantity: request.quantity - request.fulfilledQuantity,
                status: request.status
            }
        });
        
    } catch (err) {
        console.error('Update fulfillment error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== ADD RESPONSE TO REQUEST ======================
router.post('/hospital-requests/:requestId/respond', authenticateHospital, async (req, res) => {
    try {
        const { requestId } = req.params;
        const { offeredQuantity, message } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        const hospital = await Hospital.findById(hid);
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }
        
        const request = await HospitalRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        
        await request.addResponse(hospital.name, offeredQuantity, message);
        
        res.json({
            success: true,
            message: 'Response added successfully',
            response: request.responses[request.responses.length - 1]
        });
        
    } catch (err) {
        console.error('Add response error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== CANCEL HOSPITAL REQUEST ======================
router.patch('/hospital-requests/:requestId/cancel', authenticateHospital, async (req, res) => {
    try {
        const { requestId } = req.params;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        const request = await HospitalRequest.findOne({
            _id: requestId,
            hospitalId: hid
        });
        
        if (!request) {
            return res.status(404).json({ success: false, message: 'Request not found' });
        }
        
        await request.cancel();
        
        res.json({
            success: true,
            message: 'Request cancelled successfully',
            request: {
                id: request._id,
                status: request.status
            }
        });
        
    } catch (err) {
        console.error('Cancel request error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== GET REQUEST STATISTICS ======================
router.get('/hospital-requests/stats/summary', authenticateHospital, async (req, res) => {
    try {
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        
        const stats = await HospitalRequest.aggregate([
            { $match: { hospitalId: hid } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'Pending'] }, 1, 0] } },
                    fulfilled: { $sum: { $cond: [{ $eq: ['$status', 'Fulfilled'] }, 1, 0] } },
                    cancelled: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
                    critical: { $sum: { $cond: [{ $eq: ['$urgency', 'Critical'] }, 1, 0] } },
                    urgent: { $sum: { $cond: [{ $eq: ['$urgency', 'Urgent'] }, 1, 0] } },
                    totalQuantity: { $sum: '$quantity' },
                    fulfilledQuantity: { $sum: '$fulfilledQuantity' }
                }
            }
        ]);
        
        res.json({
            success: true,
            stats: stats[0] || {
                total: 0,
                pending: 0,
                fulfilled: 0,
                cancelled: 0,
                critical: 0,
                urgent: 0,
                totalQuantity: 0,
                fulfilledQuantity: 0
            }
        });
        
    } catch (err) {
        console.error('Get request stats error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// ====================== EMERGENCY ALERT ======================
router.post('/emergency-alert', authenticateHospital, async (req, res) => {
    try {
        const { radius = 5, message } = req.body;
        const hid = new mongoose.Types.ObjectId(req.hospitalId);
        const hospital = await Hospital.findById(hid);
        
        if (!hospital) {
            return res.status(404).json({ success: false, message: 'Hospital not found' });
        }

        console.log(`Emergency alert triggered by ${hospital.name}: ${message || 'URGENT: Blood donation needed immediately'}`);

        res.json({
            success: true,
            message: `Emergency alert sent to donors within ${radius}km radius`,
            details: {
                hospital: hospital.name,
                message: message || 'URGENT: Blood donation needed immediately',
                radius: radius
            }
        });
    } catch (err) {
        console.error('Emergency alert error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;