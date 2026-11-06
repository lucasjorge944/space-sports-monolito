#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { defineStacks } from '../lib/app.js';

defineStacks(new App());
