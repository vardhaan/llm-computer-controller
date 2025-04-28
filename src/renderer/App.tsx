import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChakraProvider,
  VStack,
  Input,
  Box,
  Text,
  Button,
  ButtonGroup,
  Spinner,
  createSystem,
  defaultConfig,
} from '@chakra-ui/react';
import { ThemeProvider } from 'next-themes';

// Declare the window API type
declare global {
  interface Window {
    api: {
      listApplications: () => Promise<Array<{ name: string; path: string; }>>;
      openPath: (path: string) => Promise<{success: boolean, error?: string}>;
      searchFiles: (query: string) => Promise<Array<{ name: string; path: string; }>>;
      llmQuery: (query: string) => Promise<any>;
      executeConfirmedAppleScript: (scriptContent: string) => Promise<{ success: boolean, output?: string, error?: string, errorOutput?: string }>;
    }
  }
}

// Restore theme system
const system = createSystem(defaultConfig, {
  theme: {
    tokens: {
      colors: {
        // Define any custom colors here if needed
      }
    },
    semanticTokens: {
      colors: {
        // Define semantic tokens if needed
      }
    }
  }
});

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ name: string; path: string; }>>([]);
  const [applications, setApplications] = useState<Array<{ name: string; path: string; }>>([]);

  // State for LLM text response
  const [llmResponseText, setLlmResponseText] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // State for AppleScript confirmation
  const [confirmationRequest, setConfirmationRequest] = useState<{ scriptContent: string } | null>(null);
  // Specific loading state for confirmation
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    // Load applications on mount
    if (window.api) {
      console.log("Attempting listApplications...");
      window.api.listApplications().then(setApplications).catch(console.error);
    } else {
      console.error("Initial load failed: window.api not defined.");
    }
  }, []);

  // Function to handle LLM query submission
  const handleLlmSubmit = useCallback(async () => {
    if (!searchQuery || !window.api || isLoading || isConfirming) {
      return;
    }

    console.log(`[App.tsx] Submitting LLM query: \"${searchQuery}\"`);
    setIsLoading(true);
    setLlmResponseText(null);
    setSearchResults([]);
    setConfirmationRequest(null);

    try {
      const result = await window.api.llmQuery(searchQuery);
      console.log('[App.tsx] LLM Query Result:', result);

      if (result.type === 'applescript_confirmation_required') {
        console.log('[App.tsx] AppleScript confirmation required.');
        if (result.scriptContent && typeof result.scriptContent === 'string') {
          setConfirmationRequest({ scriptContent: result.scriptContent });
        } else {
           console.error('[App.tsx] Invalid script content received for confirmation:', result.scriptContent);
           setLlmResponseText('Error: Received invalid script from assistant for confirmation.');
        }
        setLlmResponseText(null);
        setSearchResults([]);

      } else if (result.type === 'tool_executed') {
        const searchCall = result.results?.find((r: any) => r.call.function.name === 'searchFiles');
        if (searchCall && searchCall.result) {
          console.log('[App.tsx] Setting search results from tool call.');
          setSearchResults(searchCall.result);
        }
        const listCall = result.results?.find((r: any) => r.call.function.name === 'listApplications');
        if (listCall && listCall.result) {
          console.log('[App.tsx] Setting application results from tool call.');
          setApplications(listCall.result);
        }
        setLlmResponseText(null);

      } else if (result.type === 'text_response') {
        setLlmResponseText(result.content);
        setSearchResults([]);
      } else if (result.type === 'error') {
        console.error('[App.tsx] LLM Query Error:', result.error);
        setLlmResponseText(`Error: ${result.error}`);
        setSearchResults([]);
      } else {
         console.warn('[App.tsx] Received unknown response type from llmQuery:', result.type);
         setLlmResponseText(`Internal Error: Unknown response type ${result.type}`);
      }

    } catch (err) {
      console.error('[App.tsx] Error calling llmQuery:', err);
      setLlmResponseText(`IPC Error: ${(err as Error).message}`);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, isLoading, isConfirming]);

  // --- Handlers for AppleScript Confirmation ---
  const handleCancelConfirmation = useCallback(() => {
    console.log('[App.tsx] User cancelled AppleScript confirmation.');
    setConfirmationRequest(null);
    setLlmResponseText('Script execution cancelled.');
  }, []);

  const handleConfirmRun = useCallback(async () => {
    if (!confirmationRequest || !window.api || isConfirming) {
      return;
    }

    console.log('[App.tsx] User confirmed AppleScript execution. Sending to main...');
    setIsConfirming(true);
    setLlmResponseText('Executing script...');

    try {
      const execResult = await window.api.executeConfirmedAppleScript(confirmationRequest.scriptContent);
      console.log('[App.tsx] Confirmed AppleScript Execution Result:', execResult);

      if (execResult.success) {
        let successMsg = 'Script executed successfully.';
        if (execResult.output) {
          successMsg += `\\nOutput:\\n${execResult.output}`;
        }
        if (execResult.errorOutput) {
          successMsg += `\\nStderr Output:\\n${execResult.errorOutput}`;
        }
        setLlmResponseText(successMsg);
      } else {
        setLlmResponseText(`Script Execution Failed: ${execResult.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('[App.tsx] Error calling executeConfirmedAppleScript:', err);
      setLlmResponseText(`IPC Error during script execution: ${(err as Error).message}`);
    } finally {
      setConfirmationRequest(null);
      setIsConfirming(false);
    }
  }, [confirmationRequest, isConfirming]);
  // --- End Confirmation Handlers ---

  const handleItemClick = async (path: string) => {
    if (window.api) {
      try {
        const result = await window.api.openPath(path);
        if (!result.success) {
          console.error('Main process failed to open path:', result.error);
        }
      } catch (error) {
        console.error("Failed to open path:", error);
      }
    } else {
      console.error('window.api not defined for click!');
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  // Handle Enter key press in Input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleLlmSubmit();
    }
  };

  return (
    <ChakraProvider value={system}>
      <ThemeProvider attribute="class" disableTransitionOnChange>
        <VStack gap={4} p={4}>
          <Input
            placeholder="Ask or search..."
            value={searchQuery}
            onChange={handleSearch}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isConfirming || !!confirmationRequest}
          />
          
          {confirmationRequest && !isConfirming && (
             <Box
               w="100%"
               p={3}
               bg="yellow.100"
               color="gray.800"
               borderRadius="md"
               boxShadow="md"
               border="1px"
               borderColor="yellow.300"
               _dark={{ 
                 bg: "yellow.800", 
                 color: "whiteAlpha.900",
                 borderColor: "yellow.600"
               }}
             >
               <Text mb={2} fontWeight="bold">Confirm AppleScript Execution:</Text>
               <Box as="pre" fontFamily="monospace" fontSize="sm" p={2} bg="blackAlpha.100" _dark={{bg: "blackAlpha.300"}} borderRadius="sm" mb={3} overflowX="auto">
                 {confirmationRequest.scriptContent}
               </Box>
               <ButtonGroup size="sm">
                 <Button colorScheme="green" onClick={handleConfirmRun}>Run Script</Button>
                 <Button variant="outline" onClick={handleCancelConfirmation}>Cancel</Button>
               </ButtonGroup>
             </Box>
          )}
          {isConfirming && <Spinner />}

          {isLoading && !isConfirming && <Text p={2} color="gray.500">Thinking...</Text>}

          {!confirmationRequest && !isConfirming && (
             <> 
               {llmResponseText ? (
                 <Box 
                   w="100%" 
                   p={3} 
                   bg="gray.100"
                   color="gray.800"
                   _dark={{
                     bg: "gray.700",
                     color: "whiteAlpha.900"
                   }}
                   borderRadius="md" 
                   boxShadow="sm"
                 >
                   <Text whiteSpace="pre-wrap">{llmResponseText}</Text>
                 </Box>
               ) : searchResults.length > 0 ? (
                 <VStack w="100%" align="stretch" gap={1} mt={4}> 
                   {searchResults.map((result, index) => (
                     <Box
                       key={index}
                       p={2}
                       cursor="pointer"
                       _hover={{ bg: 'gray.100', _dark: { bg: 'gray.600' } }}
                       onClick={() => handleItemClick(result.path)}
                     >
                       <Text>{result.name}</Text>
                       <Text fontSize="sm" color="gray.500">{result.path}</Text>
                     </Box>
                   ))}
                 </VStack>
               ) : !searchQuery && !isLoading && applications.length > 0 ? (
                 <VStack w="100%" align="stretch" gap={1}> 
                   {applications.map((app, index) => (
                     <Box
                       key={index}
                       p={2}
                       cursor="pointer"
                       _hover={{ bg: 'gray.100', _dark: { bg: 'gray.600' } }}
                       onClick={() => handleItemClick(app.path)}
                     >
                       <Text>{app.name}</Text>
                     </Box>
                   ))}
                 </VStack>
               ) : null}
             </>
          )}

        </VStack>
      </ThemeProvider>
    </ChakraProvider>
  );
}

export default App; 