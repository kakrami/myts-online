import {startApp} from './main.js';
import {createFeatureBridge} from './features.js';
import {createReportsController} from './reports.js';
import {createDataFileController} from './data-files.js';
import {createTrackingCaptureController} from './tracking-capture.js';
const hooks=createFeatureBridge({reports:createReportsController(),dataFiles:createDataFileController(),trackingCapture:createTrackingCaptureController()});
await startApp(hooks);
