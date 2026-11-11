package fr.thomas.codexwatch

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListScope
import androidx.wear.compose.foundation.lazy.ScalingLazyListAnchorType
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

val Mint = Color(0xFFA2F4CB)
val Lilac = Color(0xFFD1C0FF)
val LiveRed = Color(0xFFFF8A8A)
val Muted = Color(0xFF96A59F)
val Ink = Color(0xFF07100D)

@Composable fun WatchTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = darkColorScheme(primary = Mint, secondary = Lilac, background = Color.Black,
        surface = Color(0xFF151E1B), onSurface = Color(0xFFF0F6F2), onPrimary = Ink)) {
        Surface(modifier = Modifier.fillMaxSize(), color = Color.Black, contentColor = Color(0xFFF0F6F2), content = content)
    }
}

@Composable fun WatchList(key: String, initialEndIndex: Int? = null, openingItemIndex: Int? = null,
    contentRevision: String = "", requestFocusRevision: String = "", requestFocusIndex: Int? = null, pauseAutoFollow: Boolean = false, onItemsVisible: (Set<Int>) -> Unit = {}, restorePosition: Boolean = false, bottomSpace: Dp = 100.dp, bottomAction: (@Composable () -> Unit)? = null,
    content: ScalingLazyListScope.() -> Unit) {
    val state = rememberScalingLazyListState(initialCenterItemIndex = 0)
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    var initiallyPositioned by remember(key) { mutableStateOf(false) }
    var followingLatest by remember(key) { mutableStateOf(true) }
    var positioning by remember(key) { mutableStateOf(false) }
    val latestEndIndex by rememberUpdatedState(initialEndIndex)
    val visibleCallback by rememberUpdatedState(onItemsVisible)
    val topInsetPx = with(LocalDensity.current) { 28.dp.roundToPx() }
    val positions = remember { mutableMapOf<String, Pair<Int, Int>>() }
    DisposableEffect(key, restorePosition) {
        onDispose { if (restorePosition) positions[key] = state.centerItemIndex to state.centerItemScrollOffset }
    }
    LaunchedEffect(key) {
        focus.requestFocus()
        if (initialEndIndex == null) {
            val saved = if (restorePosition) positions[key] else null
            if (saved != null) state.scrollToItem(saved.first, saved.second)
            else if (openingItemIndex == null) state.scrollToItem(0)
            else state.scrollToItem(openingItemIndex, (state.layoutInfo.viewportSize.height / 2 - topInsetPx).coerceAtLeast(0))
        }
    }
    // Only a completed user scroll changes whether new messages should be followed.
    // Layout changes caused by polling must not disable following before we scroll.
    LaunchedEffect(key) {
        snapshotFlow { state.isScrollInProgress }.collect { scrolling ->
            val end = latestEndIndex
            if (!scrolling && !positioning && initiallyPositioned && end != null) {
                followingLatest = state.centerItemIndex >= end || state.layoutInfo.visibleItemsInfo.any { it.index == end }
            }
        }
    }
    LaunchedEffect(key, initialEndIndex, contentRevision) {
        if (initialEndIndex != null && (!initiallyPositioned || followingLatest && !state.isScrollInProgress && !pauseAutoFollow)) {
            positioning = true
            if (!initiallyPositioned && openingItemIndex != null) {
                followingLatest = false
                state.scrollToItem(openingItemIndex, (state.layoutInfo.viewportSize.height / 2 - topInsetPx).coerceAtLeast(0))
            } else state.scrollToItem(initialEndIndex)
            initiallyPositioned = true
            positioning = false
        }
    }
    LaunchedEffect(key, requestFocusRevision) {
        if (requestFocusRevision.isNotBlank() && requestFocusIndex != null) {
            positioning = true
            state.scrollToItem(requestFocusIndex, (state.layoutInfo.viewportSize.height / 2 - topInsetPx).coerceAtLeast(0))
            initiallyPositioned = true
            followingLatest = true
            positioning = false
        }
    }
    LaunchedEffect(key, contentRevision) {
        snapshotFlow { state.layoutInfo.visibleItemsInfo.map { it.index }.toSet() }.collect { visibleCallback(it) }
    }
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF14211B), Color.Black), radius = 430f))) {
        Canvas(Modifier.fillMaxSize()) {
            drawArc(Mint.copy(alpha = .14f), 205f, 130f, false, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
            if (state.canScrollForward) drawArc(Muted.copy(alpha = .48f), -24f, 42f, false, style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
        }
        ScalingLazyColumn(state = state, autoCentering = null, anchorType = ScalingLazyListAnchorType.ItemStart,
            contentPadding = PaddingValues(start = 22.dp, end = 22.dp, top = 24.dp, bottom = if (bottomAction == null) 64.dp else bottomSpace),
            verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxSize().onRotaryScrollEvent { event ->
                scope.launch { state.scroll { scrollBy(event.verticalScrollPixels) } }; true
            }.focusRequester(focus).focusable(), content = content)
        if (bottomAction != null) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
            .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black, Color.Black)))
            .padding(start = 35.dp, end = 35.dp, top = 12.dp, bottom = 18.dp)) { bottomAction() }
    }
}

@Composable fun Eyebrow(text: String, color: Color = Mint) {
    Text(text.uppercase(), color = color, fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.6.sp,
        textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
}

@Composable fun PageTitle(title: String, subtitle: String? = null, color: Color = Mint) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
        Eyebrow(subtitle ?: "Codex Watch", color)
        Text(title, fontSize = 22.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center, modifier = Modifier.padding(top = 5.dp))
    }
}

@Composable fun WatchCard(title: String, subtitle: String? = null, icon: ImageVector = Icons.Rounded.ChevronRight,
    color: Color = Mint, enabled: Boolean = true, working: Boolean = false, titleMaxLines: Int = 2, subtitleMaxLines: Int = 3, onClick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
            .background(Brush.linearGradient(listOf(Color(0xFF1C2923), Color(0xFF141C18))), RoundedCornerShape(28.dp))
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 12.dp, vertical = 12.dp)) {
        Box(Modifier.size(28.dp).background(color.copy(alpha = .12f), CircleShape), contentAlignment = Alignment.Center) {
            if (working) CircularProgressIndicator(Modifier.size(17.dp), color = color, strokeWidth = 2.dp)
            else Icon(icon, contentDescription = null, tint = if (enabled) color else Muted, modifier = Modifier.size(17.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium, color = if (enabled) Color(0xFFF0F6F2) else Muted,
                maxLines = titleMaxLines, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) Text(subtitle, color = Muted, fontSize = 10.sp, lineHeight = 13.sp,
                maxLines = subtitleMaxLines, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 3.dp))
        }
    }
}

@Composable fun VoiceOrb(compact: Boolean = false, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        Box(Modifier.size(if (compact) 64.dp else 84.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                drawCircle(Brush.radialGradient(listOf(Lilac.copy(alpha = .14f), Color.Transparent)))
                drawArc(Lilac.copy(alpha = .4f), 150f, 240f, false, style = Stroke(1.dp.toPx(), cap = StrokeCap.Round))
            }
            Box(Modifier.size(if (compact) 52.dp else 64.dp).background(Brush.linearGradient(listOf(Color(0xFFE0D5FF), Color(0xFFAD93E9))), CircleShape)
                .clickable(onClick = onClick), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Mic, "Parler à l’assistant", tint = Color(0xFF261A39), modifier = Modifier.size(30.dp))
            }
        }
        Text("On en parle ?", fontSize = if (compact) 18.sp else 20.sp, lineHeight = if (compact) 22.sp else 24.sp, fontWeight = FontWeight.SemiBold)
        if (!compact) Text("Ton assistant, au poignet", fontSize = 10.sp, lineHeight = 13.sp, color = Muted, modifier = Modifier.padding(top = 3.dp, bottom = 4.dp))
    }
}

@Composable fun WatchQuickAction(title: String, icon: ImageVector, color: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.height(68.dp).background(color.copy(alpha = .1f), RoundedCornerShape(26.dp)).clickable(onClick = onClick).padding(horizontal = 0.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, null, tint = color, modifier = Modifier.size(22.dp))
        Text(title, color = color, fontSize = 12.sp, lineHeight = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable fun SmallNote(text: String, color: Color = Muted) {
    Text(text, color = color, fontSize = 11.sp, lineHeight = 15.sp, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp))
}

@Composable fun ActionButton(text: String, icon: ImageVector = Icons.Rounded.ArrowForward, color: Color = Mint,
    enabled: Boolean = true, working: Boolean = false, onClick: () -> Unit) {
    Button(onClick = onClick, enabled = enabled, shape = RoundedCornerShape(28.dp),
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = Ink),
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
        if (working) CircularProgressIndicator(Modifier.size(17.dp), color = color, strokeWidth = 2.dp)
        else Icon(icon, null, Modifier.size(17.dp))
        Spacer(Modifier.width(7.dp))
        Text(text, fontSize = 12.sp, lineHeight = 16.sp, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

fun statusLabel(status: String): String = when (status) {
    "active", "inProgress" -> "En cours"
    "idle", "completed" -> "Terminée"
    "failed", "systemError" -> "À vérifier"
    "interrupted" -> "Interrompue"
    else -> "Enregistrée"
}
