
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.mdslims.mobileviewer',
  appName: 'MDS LIMS Mobile Viewer',
  webDir: 'build',
  plugins: {
    FirebaseAuthentication: {
  providers: ['google.com'],
  skipNativeAuth: false
}
  }
};

export default config;
