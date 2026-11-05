import {
  ANDROID_XML_AND_GRADLE_FILES,
  AndroidSourceFile,
} from './androidXmlAndGradleFiles';
import { ANDROID_KOTLIN_CORE_FILES } from './androidKotlinCoreFiles';
import { ANDROID_KOTLIN_UI_FILES } from './androidKotlinUiFiles';

export type { AndroidSourceFile };

export const ALL_ANDROID_PROJECT_FILES: AndroidSourceFile[] = [
  ...ANDROID_XML_AND_GRADLE_FILES,
  ...ANDROID_KOTLIN_CORE_FILES,
  ...ANDROID_KOTLIN_UI_FILES,
];
