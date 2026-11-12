package fr.thomas.codexwatch

import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable fun BudgetChart(budget:JSONObject) {
    val locale = LocalConfiguration.current.locales[0] ?: java.util.Locale.getDefault()
    val limit=budget.optInt("monthlyLimitCents",500)/100.0
    val used=budget.optDouble("usedUsd").coerceAtLeast(0.0)
    val held=budget.optDouble("reservedUsd").coerceAtLeast(0.0)
    val fraction=if(limit>0)(used/limit).coerceIn(0.0,1.0).toFloat() else 0f
    val provision=if(limit>0)(held/limit).coerceIn(0.0,(1-fraction).toDouble()).toFloat() else 0f
    Column(Modifier.fillMaxWidth(),horizontalAlignment=Alignment.CenterHorizontally) {
        Box(Modifier.size(126.dp),contentAlignment=Alignment.Center) {
            Canvas(Modifier.fillMaxSize().padding(8.dp)) {
                val stroke=Stroke(9.dp.toPx(),cap=StrokeCap.Butt)
                val arcSize=Size(size.width,size.height)
                drawArc(Muted.copy(alpha=.18f),135f,270f,false,Offset.Zero,arcSize,style=stroke)
                if(fraction>0)drawArc(Mint,135f,270*fraction,false,Offset.Zero,arcSize,style=stroke)
                if(provision>0)drawArc(Lilac,135f+270*fraction,270*provision,false,Offset.Zero,arcSize,style=stroke)
            }
            Column(horizontalAlignment=Alignment.CenterHorizontally) {
                Text(dollars((limit-used-held).coerceAtLeast(0.0),locale),fontSize=19.sp,lineHeight=23.sp,fontWeight=FontWeight.SemiBold)
                Text(stringResource(R.string.ui_4a2d8a55f2a0),fontSize=10.sp,lineHeight=14.sp,color=Muted)
                Text("/ ${dollars(limit,locale)}",fontSize=10.sp,lineHeight=14.sp,color=Muted)
            }
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly) {
            Text("● ${dollars(used,locale)}",color=Mint,fontSize=10.sp,lineHeight=14.sp)
            if(held>0)Text("● ${dollars(held,locale)}",color=Lilac,fontSize=10.sp,lineHeight=14.sp)
        }
        Text(if(held>0)stringResource(R.string.ui_29257dd9fd32) else stringResource(R.string.ui_3d0ade9cc0a4),color=Muted,fontSize=9.sp,lineHeight=13.sp)
    }
}
