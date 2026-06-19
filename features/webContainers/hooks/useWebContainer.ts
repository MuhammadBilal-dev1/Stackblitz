import { useState, useEffect, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import { TemplateFolder } from '@/features/playground/lib/path-to-json';

// Declare a global variable to hold the WebContainer instance
// This ensures it's shared across all uses of the hook
let globalWebContainerInstance: WebContainer | null = null;
// Use a promise to track if an instance is already in the process of booting
let bootingPromise: Promise<WebContainer> | null = null;

interface UseWebContainerProps {
  templateData: TemplateFolder;
}

interface UseWebContainerReturn {
  serverUrl: string | null;
  isLoading: boolean;
  error: string | null;
  instance: WebContainer | null;
  writeFileSync: (path: string, content: string) => Promise<void>;
  destroy: () => void; // Added destroy function
}

export const useWebContainer = ({ templateData }: UseWebContainerProps): UseWebContainerReturn => {
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instance, setInstance] = useState<WebContainer | null>(null);

  useEffect(() => {
    let mounted = true;

    async function getOrCreateWebContainer() {
      // If an instance already exists, return it immediately
      if (globalWebContainerInstance) {
        return globalWebContainerInstance;
      }

      // If an instance is currently booting, wait for that promise to resolve
      if (bootingPromise) {
        return bootingPromise;
      }

      // No instance exists and no boot in progress, so start booting
      bootingPromise = WebContainer.boot();
      console.log('Booting new WebContainer instance...');
      const webcontainerInstance = await bootingPromise;
      console.log('WebContainer booted!');
      
      // Store the instance globally
      globalWebContainerInstance = webcontainerInstance;
      bootingPromise = null; // Clear the promise once boot is complete
      return webcontainerInstance;
    }

    async function initializeWebContainer() {
      try {
        const webcontainerInstance = await getOrCreateWebContainer();
        
        if (!mounted) {
          if (webcontainerInstance && webcontainerInstance !== globalWebContainerInstance) {
              webcontainerInstance.teardown();
          }
          return
        };
        
        setInstance(webcontainerInstance);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to initialize WebContainer:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize WebContainer');
          setIsLoading(false);
        }
      }
    }

    initializeWebContainer();

    return () => {
      mounted = false;
      // if (instance) {
      //   instance.teardown();
      // }
    };
  }, []);

  const writeFileSync = useCallback(async (path: string, content: string): Promise<void> => {
    if (!instance) {
      throw new Error('WebContainer instance is not available');
    }

    try {
      // Ensure the folder structure exists
      const pathParts = path.split('/');
      const folderPath = pathParts.slice(0, -1).join('/'); // Extract folder path

      if (folderPath) {
        await instance.fs.mkdir(folderPath, { recursive: true }); // Create folder structure recursively
      }

      // Write the file
      await instance.fs.writeFile(path, content);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to write file';
      console.error(`Failed to write file at ${path}:`, err);
      throw new Error(`Failed to write file at ${path}: ${errorMessage}`);
    }
  }, [instance]);

  // Added destroy function
  const destroy = useCallback(() => {
    if (globalWebContainerInstance) {
      globalWebContainerInstance.teardown();
      globalWebContainerInstance = null; // Reset the global instance
      bootingPromise = null; // Reset booting promise
      setInstance(null); // Clear local state
      setServerUrl(null);
      console.log("WebContainer instance destroyed.");
    }
  }, []);

  return { serverUrl, isLoading, error, instance, writeFileSync, destroy };
};