const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  donorName: {
    type: String,
    required: true
  },
  requestTitle: {
    type: String,
    default: ''
  },
  hospitalName: {
    type: String,
    required: true
  },
  hospitalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hospital',
    required: false
  },
  units: {
    type: Number,
    default: 1,
    min: 1
  },
  donationType: {
    type: String,
    required: true,
    enum: ['Whole Blood', 'Platelets', 'Plasma', 'Red Blood Cells', 'Bone Marrow', 'Stem Cells', 'Other'],
    default: 'Whole Blood'
  },
  bloodType: {
    type: String,
    required: function() {
      return ['Whole Blood', 'Platelets', 'Plasma', 'Red Blood Cells'].includes(this.donationType);
    },
    enum: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Other', 'Unknown'],
    default: 'Unknown'
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Completed', 'Rejected', 'Eligible'],
    default: 'Pending'
  },
  confirmedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Hospital' 
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// FIXED: Use regular function (not arrow function) for pre-save hook
donationSchema.pre('save', function(next) {
  // 'this' refers to the document being saved
  this.updatedAt = new Date();
  
  // Ensure units is a number
  if (this.units && typeof this.units === 'string') {
    this.units = parseInt(this.units);
  }
  
  // Make sure to call next() to continue the save operation
  if (next && typeof next === 'function') {
    next();
  }
});

// Optional: Add a post-save hook for debugging (won't affect the error)
donationSchema.post('save', function(doc) {
  console.log('✅ Donation saved:', {
    id: doc._id,
    donorName: doc.donorName,
    donationType: doc.donationType,
    status: doc.status
  });
});

// Indexes for better query performance
donationSchema.index({ hospitalId: 1, status: 1 });
donationSchema.index({ hospitalName: 1, status: 1 });
donationSchema.index({ createdAt: -1 });
donationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Donation', donationSchema);