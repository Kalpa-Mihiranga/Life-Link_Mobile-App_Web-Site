const mongoose = require('mongoose');

const hospitalSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    trim: true 
  },
  regNumber: { 
    type: String, 
    required: true, 
    unique: true, 
    trim: true 
  },
  address: { 
    type: String, 
    required: true 
  },
  contact: { 
    type: String, 
    required: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true 
  },
  password: { 
    type: String, 
    required: true 
  },
  storageCapacity: { 
    type: Number, 
    required: true,
    min: 0
  },

  // Blood inventory from your React form
  bloodInventory: { 
    type: Object, 
    default: {} 
  },
  selectedBloodTypes: [{ 
    type: String 
  }],

  // Documents (real file paths saved by Multer)
  documents: {
    govtCertificate: { type: String, default: '' },
    medicalLicense: { type: String, default: '' },
    authorizedId: { type: String, default: '' }
  },

  // Avatar (matches your existing collection)
  avatarUrl: { 
    type: String, 
    default: 'http://10.168.30.144:3000/uploads/avatars/default-hospital.png' 
  },

  city: {
    type: String,
    default: ''
  },

  isVerified: { 
    type: Boolean, 
    default: false 
  }

}, {
  // Add timestamps to automatically manage createdAt and updatedAt
  timestamps: true
});

// Add indexes for better query performance
hospitalSchema.index({ email: 1 });
hospitalSchema.index({ regNumber: 1 });
hospitalSchema.index({ isVerified: 1 });
hospitalSchema.index({ city: 1 });

// Virtual for full address
hospitalSchema.virtual('fullAddress').get(function() {
  return this.address;
});

// Method to check if hospital has sufficient blood stock
hospitalSchema.methods.hasSufficientBlood = function(bloodType, requiredUnits) {
  const currentUnits = this.bloodInventory[bloodType] || 0;
  return currentUnits >= requiredUnits;
};

// Method to update blood inventory
hospitalSchema.methods.updateBloodInventory = function(bloodType, units, operation = 'add') {
  const currentUnits = this.bloodInventory[bloodType] || 0;
  
  if (operation === 'add') {
    this.bloodInventory[bloodType] = currentUnits + units;
  } else if (operation === 'remove') {
    this.bloodInventory[bloodType] = Math.max(0, currentUnits - units);
  } else if (operation === 'set') {
    this.bloodInventory[bloodType] = units;
  }
  
  // Remove blood type if units become 0
  if (this.bloodInventory[bloodType] === 0) {
    delete this.bloodInventory[bloodType];
  }
  
  return this.save();
};

// Method to get blood stock status
hospitalSchema.methods.getBloodStockStatus = function() {
  const inventory = this.bloodInventory || {};
  const status = {
    critical: [],
    low: [],
    normal: [],
    totalUnits: 0
  };
  
  Object.entries(inventory).forEach(([bloodType, units]) => {
    status.totalUnits += units;
    
    if (units <= 5) {
      status.critical.push({ bloodType, units });
    } else if (units <= 10) {
      status.low.push({ bloodType, units });
    } else {
      status.normal.push({ bloodType, units });
    }
  });
  
  return status;
};

// Method to check if hospital is properly set up
hospitalSchema.methods.isComplete = function() {
  return this.name && 
         this.regNumber && 
         this.email && 
         this.password && 
         this.address && 
         this.contact;
};

// Static method to find hospitals by blood type availability
hospitalSchema.statics.findByBloodAvailability = function(bloodType, requiredUnits) {
  return this.find({
    [`bloodInventory.${bloodType}`]: { $gte: requiredUnits },
    isVerified: true
  }).select('name address contact bloodInventory');
};

// Pre-save middleware to ensure data consistency
hospitalSchema.pre('save', function(next) {
  // Ensure selectedBloodTypes is an array
  if (this.selectedBloodTypes && !Array.isArray(this.selectedBloodTypes)) {
    this.selectedBloodTypes = [this.selectedBloodTypes];
  }
  
  // Ensure bloodInventory is an object
  if (this.bloodInventory && typeof this.bloodInventory !== 'object') {
    this.bloodInventory = {};
  }
  
  // Trim whitespace from contact
  if (this.contact) {
    this.contact = this.contact.trim();
  }
  
  // Ensure storageCapacity is a positive number
  if (this.storageCapacity < 0) {
    this.storageCapacity = 0;
  }
  
  next();
});

// Post-save hook for logging (optional)
hospitalSchema.post('save', function(doc) {
  console.log('🏥 Hospital saved:', {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    isVerified: doc.isVerified
  });
});

// To JSON transform (remove sensitive data)
hospitalSchema.set('toJSON', {
  transform: function(doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

// To Object transform
hospitalSchema.set('toObject', {
  transform: function(doc, ret) {
    delete ret.password;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Hospital', hospitalSchema);