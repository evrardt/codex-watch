package fr.thomas.codexwatch
import org.junit.Assert.*
import org.junit.Test
class TransportRouterTest {
 @Test fun autoUsesConnectedBluetoothThenInternetAndFallsBackWhenUnavailable(){
  assertEquals(listOf("bluetooth","internet"),transportOrder("auto",true,true))
  assertEquals(listOf("internet","bluetooth"),transportOrder("auto",true,false))
  assertEquals(listOf("internet"),transportOrder("auto",false,false))
  assertEquals(listOf("bluetooth"),transportOrder("bluetooth",true,false))
  assertEquals(listOf("internet"),transportOrder("internet",true,true))
 }
 @Test fun replayRequiresIdempotence(){
  assertTrue(canRetryOnAnotherTransport("GET","/v1/health",null))
  assertTrue(canRetryOnAnotherTransport("POST","/v1/threads/abc/messages","receipt-id"))
  assertFalse(canRetryOnAnotherTransport("POST","/v1/threads/abc/messages",null))
  assertFalse(canRetryOnAnotherTransport("POST","/v1/approvals/abc", "receipt-id"))
  assertFalse(canRetryOnAnotherTransport("PUT","/v1/audio/speed",null))
 }
}
