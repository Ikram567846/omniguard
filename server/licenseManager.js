// OmniGuard Commercial License & Subscription Engine
const crypto = require('crypto');

class LicenseManager {
  constructor() {
    this.activeLicenses = new Map(); // deviceId -> LicenseDetails
    this.validLicensePool = new Map(); // licenseKey -> LicenseSpec
    this.seedDefaultLicenses();
  }

  seedDefaultLicenses() {
    // Pre-seed official commercial license keys for immediate activation
    this.validLicensePool.set('OMNI-PRO-2027-88A1-94F2', {
      tier: 'PROFESSIONAL',
      maxDevices: 10,
      features: ['UNATTENDED_ACCESS', '4WAY_CCTV_GRID', 'AI_SENSORS', 'HIGH_FPS', 'CUSTOM_BRANDING'],
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 Year
    });

    this.validLicensePool.set('OMNI-ENT-2028-99B2-77C1', {
      tier: 'ENTERPRISE',
      maxDevices: 100,
      features: ['UNATTENDED_ACCESS', '16WAY_CCTV_GRID', 'AI_SENSORS', 'CLOUD_BACKUP', 'DEDICATED_RELAY'],
      expiresAt: Date.now() + 730 * 24 * 60 * 60 * 1000 // 2 Years
    });
  }

  generateLicenseKey(tier = 'PROFESSIONAL', validYears = 1) {
    const prefix = tier === 'ENTERPRISE' ? 'OMNI-ENT' : 'OMNI-PRO';
    const year = new Date().getFullYear() + validYears;
    const randomHex1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const randomHex2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const key = `${prefix}-${year}-${randomHex1}-${randomHex2}`;

    const spec = {
      tier: tier,
      maxDevices: tier === 'ENTERPRISE' ? 100 : 10,
      features: tier === 'ENTERPRISE'
        ? ['UNATTENDED_ACCESS', '16WAY_CCTV_GRID', 'AI_SENSORS', 'CLOUD_BACKUP', 'DEDICATED_RELAY']
        : ['UNATTENDED_ACCESS', '4WAY_CCTV_GRID', 'AI_SENSORS', 'HIGH_FPS'],
      expiresAt: Date.now() + validYears * 365 * 24 * 60 * 60 * 1000
    };

    this.validLicensePool.set(key, spec);
    return key;
  }

  activateLicense(deviceId, licenseKey) {
    if (!deviceId || !licenseKey) {
      return { success: false, error: 'DeviceId and License Key required.' };
    }

    const cleanKey = licenseKey.trim().toUpperCase();
    const spec = this.validLicensePool.get(cleanKey);

    if (!spec) {
      return { success: false, error: 'Invalid or unrecognized Commercial License Key.' };
    }

    if (Date.now() > spec.expiresAt) {
      return { success: false, error: 'License key has expired. Please renew.' };
    }

    const activation = {
      key: cleanKey,
      tier: spec.tier,
      maxDevices: spec.maxDevices,
      features: spec.features,
      activatedAt: Date.now(),
      expiresAt: spec.expiresAt
    };

    this.activeLicenses.set(deviceId, activation);
    return {
      success: true,
      message: `Commercial ${spec.tier} License activated successfully!`,
      license: activation
    };
  }

  getDeviceLicense(deviceId) {
    return this.activeLicenses.get(deviceId) || {
      tier: 'COMMUNITY_FREE',
      maxDevices: 2,
      features: ['BASIC_REMOTE_DESKTOP', 'BASIC_CAMERA'],
      expiresAt: null
    };
  }
}

module.exports = new LicenseManager();
