const express = require('express');
const PaymentTag = require('../models/PaymentTag');
const authMiddleware = require('../middleware/auth');
const { adminLimiter, studentProfileLimiter } = require('../middleware/rateLimiter');

// ── Helper to build standard UPI deep links ──
function buildUpiLinks({ payeeUpiId, payeeName, amount }) {
    const upid = String(payeeUpiId || '').trim();
    const cleanAmount = Number(amount || 0);
    const name = encodeURIComponent(String(payeeName || 'Merchant').trim());
    const baseQuery = `pa=${upid}&pn=${name}&am=${cleanAmount}&cu=INR`;

    return {
        upiIntentUrl: `upi://pay?${baseQuery}`,
        gpayUrl: `tez://upi/pay?${baseQuery}`,
        phonepeUrl: `phonepe://pay?${baseQuery}`,
        paytmUrl: `paytmmp://pay?${baseQuery}`,
        bhimUrl: `upi://pay?${baseQuery}`,
        qrPayload: `upi://pay?${baseQuery}`
    };
}

// ──────────────────────────────────────────────
// PUBLIC ROUTER (When customer taps NFC card)
// ──────────────────────────────────────────────
const publicRouter = express.Router();

// @route   GET /api/pay/:tagCode
// @desc    Get NFC tag payment details and dynamic UPI deep links
// @access  Public
publicRouter.get('/:tagCode', studentProfileLimiter, async (req, res) => {
    try {
        const tagCode = (req.params.tagCode || '').trim().toUpperCase();
        if (!tagCode) {
            return res.status(400).json({ success: false, message: 'Tag code is required' });
        }

        const tag = await PaymentTag.findOne({
            tagCode: new RegExp(`^${tagCode}$`, 'i'),
            isActive: true
        });

        if (!tag) {
            return res.status(404).json({
                success: false,
                message: `Payment tag "${tagCode}" not found or is currently inactive.`
            });
        }

        // Increment scan count in background
        tag.recordScan().catch(err => console.error('Error recording payment tag scan:', err.message));

        const links = buildUpiLinks({
            payeeUpiId: tag.payeeUpiId,
            payeeName: tag.payeeName,
            amount: tag.amount,
            note: tag.note || tag.title,
            tagCode: tag.tagCode
        });

        res.json({
            success: true,
            data: {
                tagCode: tag.tagCode,
                title: tag.title,
                payeeName: tag.payeeName,
                payeeUpiId: tag.payeeUpiId,
                amount: tag.amount,
                currency: tag.currency,
                note: tag.note,
                allowCustomAmount: tag.allowCustomAmount,
                totalScans: tag.totalScans + 1,
                links
            }
        });
    } catch (err) {
        console.error('Error in GET /api/pay/:tagCode:', err);
        res.status(500).json({ success: false, message: 'Server error retrieving payment tag' });
    }
});

// ──────────────────────────────────────────────
// ADMIN ROUTER (For Admin dashboard management)
// ──────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authMiddleware);
adminRouter.use(adminLimiter);

// @route   GET /api/admin/payment-tags
// @desc    List all payment tags
// @access  Admin only
adminRouter.get('/', async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};
        if (search) {
            const regex = new RegExp(search.trim(), 'i');
            query = {
                $or: [
                    { tagCode: regex },
                    { payeeName: regex },
                    { payeeUpiId: regex },
                    { title: regex }
                ]
            };
        }

        const tags = await PaymentTag.find(query).sort({ updatedAt: -1 });
        const totalCount = await PaymentTag.countDocuments();
        const activeCount = await PaymentTag.countDocuments({ isActive: true });
        const totalScans = tags.reduce((acc, t) => acc + (t.totalScans || 0), 0);

        res.json({
            success: true,
            data: tags,
            stats: {
                totalCount,
                activeCount,
                totalScans
            }
        });
    } catch (err) {
        console.error('Error in GET /api/admin/payment-tags:', err);
        res.status(500).json({ success: false, message: 'Server error fetching payment tags' });
    }
});

// @route   POST /api/admin/payment-tags
// @desc    Create a new NFC payment tag
// @access  Admin only
adminRouter.post('/', async (req, res) => {
    try {
        let { tagCode, title, payeeUpiId, payeeName, amount, note, allowCustomAmount, artistId } = req.body;

        if (!tagCode || !payeeUpiId || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Tag Code, Payee UPI ID, and Amount are required.'
            });
        }

        tagCode = tagCode.trim().toUpperCase();
        payeeUpiId = payeeUpiId.trim().toLowerCase();
        payeeName = (payeeName || 'Artube').trim();
        amount = Number(amount);

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
        }

        // Check if tagCode already exists
        const existing = await PaymentTag.findOne({ tagCode });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: `Payment tag with code "${tagCode}" already exists.`
            });
        }

        const newTag = await PaymentTag.create({
            tagCode,
            title: title || '',
            payeeUpiId,
            payeeName,
            amount,
            note: note || '',
            allowCustomAmount: Boolean(allowCustomAmount),
            artistId: artistId || ''
        });

        res.status(201).json({
            success: true,
            message: 'Payment tag created successfully',
            data: newTag
        });
    } catch (err) {
        console.error('Error in POST /api/admin/payment-tags:', err);
        res.status(500).json({ success: false, message: err.message || 'Error creating payment tag' });
    }
});

// @route   PATCH /api/admin/payment-tags/:id/amount
// @desc    Quick update amount for a payment tag (1-click price change)
// @access  Admin only
adminRouter.patch('/:id/amount', async (req, res) => {
    try {
        const { id } = req.params;
        const amount = Number(req.body.amount);

        if (isNaN(amount) || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Valid positive amount is required.' });
        }

        const tag = await PaymentTag.findByIdAndUpdate(
            id,
            { amount },
            { new: true, runValidators: true }
        );

        if (!tag) {
            return res.status(404).json({ success: false, message: 'Payment tag not found.' });
        }

        res.json({
            success: true,
            message: `Amount for ${tag.tagCode} updated to ₹${amount}`,
            data: tag
        });
    } catch (err) {
        console.error('Error in PATCH /api/admin/payment-tags/:id/amount:', err);
        res.status(500).json({ success: false, message: err.message || 'Error updating amount' });
    }
});

// @route   PUT /api/admin/payment-tags/:id
// @desc    Update full payment tag details
// @access  Admin only
adminRouter.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, payeeUpiId, payeeName, amount, note, isActive, allowCustomAmount } = req.body;

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (payeeUpiId !== undefined) updateData.payeeUpiId = payeeUpiId.trim().toLowerCase();
        if (payeeName !== undefined) updateData.payeeName = payeeName.trim();
        if (amount !== undefined) {
            const numAmount = Number(amount);
            if (isNaN(numAmount) || numAmount <= 0) {
                return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
            }
            updateData.amount = numAmount;
        }
        if (note !== undefined) updateData.note = note;
        if (isActive !== undefined) updateData.isActive = Boolean(isActive);
        if (allowCustomAmount !== undefined) updateData.allowCustomAmount = Boolean(allowCustomAmount);

        const tag = await PaymentTag.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        if (!tag) {
            return res.status(404).json({ success: false, message: 'Payment tag not found.' });
        }

        res.json({
            success: true,
            message: 'Payment tag updated successfully',
            data: tag
        });
    } catch (err) {
        console.error('Error in PUT /api/admin/payment-tags/:id:', err);
        res.status(500).json({ success: false, message: err.message || 'Error updating payment tag' });
    }
});

// @route   DELETE /api/admin/payment-tags/:id
// @desc    Delete a payment tag
// @access  Admin only
adminRouter.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tag = await PaymentTag.findByIdAndDelete(id);
        if (!tag) {
            return res.status(404).json({ success: false, message: 'Payment tag not found.' });
        }
        res.json({
            success: true,
            message: `Payment tag "${tag.tagCode}" deleted successfully.`
        });
    } catch (err) {
        console.error('Error in DELETE /api/admin/payment-tags/:id:', err);
        res.status(500).json({ success: false, message: 'Error deleting payment tag' });
    }
});

module.exports = {
    publicRouter,
    adminRouter
};
