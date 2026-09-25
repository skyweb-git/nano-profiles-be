const mongoose = require('mongoose');

const paymentTagSchema = new mongoose.Schema({
    tagCode: {
        type: String,
        required: [true, 'Tag code is required'],
        unique: true,
        trim: true,
        uppercase: true,
        index: true
    },
    title: {
        type: String,
        trim: true,
        default: ''
    },
    payeeUpiId: {
        type: String,
        required: [true, 'Payee UPI ID is required'],
        trim: true,
        lowercase: true,
        match: [/^[\w.\-_]{2,256}@[a-zA-Z]{2,64}$/, 'Please enter a valid UPI ID (e.g. name@bank)']
    },
    payeeName: {
        type: String,
        required: [true, 'Payee name is required'],
        trim: true,
        default: 'Artube'
    },
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [1, 'Amount must be at least ₹1']
    },
    currency: {
        type: String,
        trim: true,
        default: 'INR'
    },
    note: {
        type: String,
        trim: true,
        default: ''
    },
    allowCustomAmount: {
        type: Boolean,
        default: false
    },
    artistId: {
        type: String,
        trim: true,
        default: ''
    },
    totalScans: {
        type: Number,
        default: 0
    },
    lastScannedAt: {
        type: Date
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    }
}, {
    timestamps: true
});

// Helper to record a scan/tap
paymentTagSchema.methods.recordScan = async function () {
    this.totalScans = (this.totalScans || 0) + 1;
    this.lastScannedAt = new Date();
    return this.save();
};

module.exports = mongoose.model('PaymentTag', paymentTagSchema);
