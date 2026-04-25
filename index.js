require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3007;

const ok = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const err = (res, message, status = 400) => res.status(status).json({ success: false, message });

const requiredConfig = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];

const hasSmtpConfig = () =>
  requiredConfig.every((key) => (process.env[key] || '').toString().trim());

const createTransport = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const formatDateTime = (value) => new Date(value).toLocaleString('en-IN', {
  dateStyle: 'full',
  timeStyle: 'short',
});

const escapeHtml = (value = '') =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const titleCase = (value = '') => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const normalizeReason = (reason = '') => {
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const normalized = titleCase(trimmed);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const getRejectionContext = (reason = '') => {
  const normalized = reason.toLowerCase();
  if (normalized.includes('date') || normalized.includes('time') || normalized.includes('slot') || normalized.includes('availability')) {
    return 'Unfortunately, the requested appointment slot is not available right now.';
  }
  if (normalized.includes('address') || normalized.includes('location') || normalized.includes('service area')) {
    return 'At the moment, we are unable to cover the requested service location.';
  }
  if (normalized.includes('duplicate')) {
    return 'It looks like this request overlaps with another existing booking.';
  }
  if (normalized.includes('payment')) {
    return 'We are unable to proceed until the request details and payment requirements are aligned.';
  }
  return 'After reviewing the request details, we are unable to confirm this booking at the moment.';
};

const orderSummaryText = (order) => [
  `Service: ${order.serviceName}`,
  `Appointment: ${formatDateTime(order.scheduledDate)}`,
  `Address: ${order.address}`,
  `Amount: $${order.amount}`,
  `Reference: #${String(order._id || '').slice(-6)}`,
].join('\n');

const renderEmail = (eventType, order) => {
  const customerName = order.userName || 'there';
  const scheduledDate = formatDateTime(order.scheduledDate);
  const amount = `$${order.amount}`;
  const reference = `#${String(order._id || '').slice(-6)}`;
  const escapedDescription = escapeHtml(order.description || '');
  const escapedAddress = escapeHtml(order.address || '');
  const escapedService = escapeHtml(order.serviceName || 'your service request');

  if (eventType === 'APPROVED') {
    return {
      subject: `Your ${order.serviceName} request is approved - ${reference}`,
      text: [
        `Hi ${customerName},`,
        '',
        `Good news. Your ${order.serviceName} request has been approved by the Vaultrix team.`,
        '',
        orderSummaryText(order),
        '',
        `Request details: ${order.description}`,
        '',
        'Please keep this appointment slot available. If anything changes, our team will keep you informed.',
        '',
        'Thank you for choosing Vaultrix.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
          <h2 style="color: #4f46e5;">Your ${escapedService} request is approved</h2>
          <p>Hi ${escapeHtml(customerName)},</p>
          <p>Good news. Your <strong>${escapedService}</strong> request has been approved by the Vaultrix team.</p>
          <div style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p><strong>Appointment:</strong> ${escapeHtml(scheduledDate)}</p>
            <p><strong>Address:</strong> ${escapedAddress}</p>
            <p><strong>Amount:</strong> ${escapeHtml(amount)}</p>
            <p><strong>Reference:</strong> ${escapeHtml(reference)}</p>
          </div>
          <p><strong>What you requested:</strong> ${escapedDescription}</p>
          <p>Please keep this appointment slot available. If anything changes, our team will keep you informed.</p>
          <p>Thank you for choosing Vaultrix.</p>
        </div>
      `,
    };
  }

  if (eventType === 'REJECTED') {
    const polishedReason = normalizeReason(order.rejectionReason);
    const rejectionContext = getRejectionContext(order.rejectionReason);

    return {
      subject: `Update on your ${order.serviceName} request - ${reference}`,
      text: [
        `Hi ${customerName},`,
        '',
        `We are sorry, but we are unable to approve your ${order.serviceName} request at this time.`,
        '',
        rejectionContext,
        polishedReason,
        '',
        orderSummaryText(order),
        '',
        'We sincerely apologize for the inconvenience. If you would like, you can submit a new request with updated details and we will be happy to review it again.',
        '',
        'Thank you for your understanding.',
      ].join('\n'),
      html: `
        <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
          <h2 style="color: #dc2626;">We are sorry - your ${escapedService} request could not be approved</h2>
          <p>Hi ${escapeHtml(customerName)},</p>
          <p>We are sorry, but we are unable to approve your <strong>${escapedService}</strong> request at this time.</p>
          <p>${escapeHtml(rejectionContext)}</p>
          <p>${escapeHtml(polishedReason)}</p>
          <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 16px; margin: 16px 0;">
            <p><strong>Requested appointment:</strong> ${escapeHtml(scheduledDate)}</p>
            <p><strong>Address:</strong> ${escapedAddress}</p>
            <p><strong>Reference:</strong> ${escapeHtml(reference)}</p>
          </div>
          <p>We sincerely apologize for the inconvenience. If you would like, you can submit a new request with updated details and we will be happy to review it again.</p>
          <p>Thank you for your understanding.</p>
        </div>
      `,
    };
  }

  return {
    subject: `Your ${order.serviceName} service is complete - ${reference}`,
    text: [
      `Hi ${customerName},`,
      '',
      `Your ${order.serviceName} request has now been marked as completed.`,
      '',
      orderSummaryText(order),
      '',
      'We hope you had a smooth and satisfying experience with Vaultrix.',
      'Thank you for trusting us with your service request, and we look forward to helping you again.',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6;">
        <h2 style="color: #059669;">Your ${escapedService} service is complete</h2>
        <p>Hi ${escapeHtml(customerName)},</p>
        <p>Your <strong>${escapedService}</strong> request has now been marked as completed.</p>
        <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 16px; margin: 16px 0;">
          <p><strong>Appointment:</strong> ${escapeHtml(scheduledDate)}</p>
          <p><strong>Address:</strong> ${escapedAddress}</p>
          <p><strong>Amount:</strong> ${escapeHtml(amount)}</p>
          <p><strong>Reference:</strong> ${escapeHtml(reference)}</p>
        </div>
        <p>We hope you had a smooth and satisfying experience with Vaultrix.</p>
        <p>Thank you for trusting us with your service request, and we look forward to helping you again.</p>
      </div>
    `,
  };
};

app.post('/notifications/order-status', async (req, res) => {
  try {
    const { eventType, order } = req.body;
    if (!eventType || !order) return err(res, 'eventType and order are required.');
    if (!['APPROVED', 'REJECTED', 'COMPLETED'].includes(eventType))
      return err(res, 'Unsupported eventType.', 422);
    if (!order.userEmail) return err(res, 'Order is missing userEmail.', 422);
    if (eventType === 'REJECTED' && !String(order.rejectionReason || '').trim())
      return err(res, 'A rejection reason is required to draft the rejection email.', 422);
    if (!hasSmtpConfig())
      return err(res, 'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.', 500);

    const transporter = createTransport();
    const email = renderEmail(eventType, order);
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER;
    const fromName = process.env.SMTP_FROM_NAME || 'Vaultrix';

    const result = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: order.userEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    ok(res, {
      message: `Notification email sent to ${order.userEmail}.`,
      messageId: result.messageId,
    });
  } catch (error) {
    err(res, error.message || 'Failed to send notification email.', 500);
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'notification-service',
    smtpConfigured: hasSmtpConfig(),
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[notification-service] running on port ${PORT}`);
});
